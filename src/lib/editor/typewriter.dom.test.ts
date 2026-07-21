import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState, EditorSelection } from "@codemirror/state";
import { editorExtensions } from "./setup";
import { DEFAULT_TYPEWRITER_ANCHOR, setTypewriter, typewriterConfig } from "./typewriter";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

type Geometry = {
  scrollTop?: number;
  clientHeight?: number;
  scrollHeight?: number;
  clientWidth?: number;
  scrollWidth?: number;
  /** The caret's visual ROW, in px from the top of the scroller's box. */
  caret?: { top: number; bottom: number } | null;
};

/**
 * happy-dom reports 0 for every layout box and has no caret geometry, so the scroller
 * metrics and `coordsAtPos` have to be stubbed. Everything above them — the facet, the
 * handler registration, the measure read/write, the branch logic — is the real thing.
 */
function build(typewriter = true, geom: Geometry = {}): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc: "line one\nline two\nline three",
      extensions: editorExtensions(true, "clean", { style: "spaces", width: 2 }, true, undefined, typewriter),
    }),
    parent: document.body,
  });
  const {
    scrollTop = 1000,
    clientHeight = 800,
    scrollHeight = 10000,
    clientWidth = 600,
    scrollWidth = 600,
    caret = { top: 700, bottom: 720 },
  } = geom;
  let top = scrollTop;
  Object.defineProperties(v.scrollDOM, {
    scrollTop: { configurable: true, get: () => top, set: (n: number) => (top = n) },
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientWidth: { configurable: true, get: () => clientWidth },
    scrollWidth: { configurable: true, get: () => scrollWidth },
  });
  v.scrollDOM.getBoundingClientRect = () =>
    ({ top: 0, bottom: clientHeight, height: clientHeight }) as DOMRect;
  v.coordsAtPos = () => (caret ? { top: caret.top, bottom: caret.bottom, left: 0, right: 1 } : null);
  view = v;
  return v;
}

/**
 * Run the handler the way `docView.scrollIntoView` does, then drain the measure request
 * it scheduled — CodeMirror processes it in the same measure loop, one frame, with no
 * paint in between. Returns what the handler told CodeMirror, and whether it measured.
 */
function scrollIntoViewCycle(
  v: EditorView,
  y: "nearest" | "center" | "start" | "end" = "nearest",
): { handled: boolean; measured: boolean } {
  type Req = { read: (v: EditorView) => unknown; write: (r: unknown, v: EditorView) => void };
  const requests: Req[] = [];
  v.requestMeasure = ((req?: Req) => {
    if (req) requests.push(req);
  }) as EditorView["requestMeasure"];
  const handled = runScrollHandlers(v, y);
  for (const r of requests) r.write(r.read(v), v);
  return { handled, measured: requests.length > 0 };
}

/** Run the registered scroll handlers the way `docView.scrollIntoView` does. */
function runScrollHandlers(
  v: EditorView,
  y: "nearest" | "center" | "start" | "end" = "nearest",
): boolean {
  const range = EditorSelection.cursor(v.state.doc.length);
  return v.state
    .facet(EditorView.scrollHandler)
    .some((h) => h(v, range, { x: "nearest", y, xMargin: 0, yMargin: 0 }));
}

describe("[REQ-SCROLL-1] typewriter scroll handler", () => {
  it("settles the caret's row on the anchor when it is below it", () => {
    // Default anchor 2/3: an 800px viewport puts the resting point at 533, and the
    // caret's row (700..720, centre 710) is 177px below it.
    const v = build(true);
    expect(scrollIntoViewCycle(v)).toEqual({ handled: false, measured: true });
    expect(v.scrollDOM.scrollTop).toBe(1177);
  });

  it("NEVER reports the scroll as handled, so CodeMirror always scrolls too", () => {
    // Structural safety: returning true would suppress CodeMirror's own scrolling —
    // including its horizontal scroll and the corrective scroll that keeps the caret on
    // screen. The worst this design can do is "no centring", never "caret off screen".
    const geometries: Geometry[] = [
      {},
      { caret: { top: 100, bottom: 120 } },
      { caret: null },
      { clientHeight: 0 },
    ];
    for (const geom of geometries) {
      const v = build(true, geom);
      expect(scrollIntoViewCycle(v).handled).toBe(false);
      v.destroy();
    }
  });

  it("leaves the scroll alone when the caret's row is at or above the anchor", () => {
    const v = build(true, { caret: { top: 100, bottom: 120 } });
    expect(scrollIntoViewCycle(v).measured).toBe(true);
    expect(v.scrollDOM.scrollTop).toBe(1000); // untouched — CM's minimal scrolling stands
  });

  it("honours a custom anchor set through setTypewriter", () => {
    // 0.5 is the old centring behaviour; the setting exists so the resting point can
    // be tuned per taste without a rebuild (`editor.typewriterAnchor`).
    const v = build(true);
    setTypewriter(v, true, 0.5);
    expect(v.state.facet(typewriterConfig).anchor).toBe(0.5);
    expect(scrollIntoViewCycle(v).measured).toBe(true);
    expect(v.scrollDOM.scrollTop).toBe(1310);
  });

  it("defaults the anchor to two thirds when setTypewriter is given only a toggle", () => {
    const v = build(true);
    setTypewriter(v, true);
    expect(v.state.facet(typewriterConfig).anchor).toBe(DEFAULT_TYPEWRITER_ANCHOR);
  });

  it("does not schedule any measurement when the setting is off", () => {
    const v = build(false);
    expect(scrollIntoViewCycle(v)).toEqual({ handled: false, measured: false });
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("declines for an explicit scroll strategy, so y:'center'/'start'/'end' are honoured", () => {
    // Any caller that asks for a specific placement must land where THEY asked, not
    // where the typewriter would have put it.
    const v = build(true);
    for (const y of ["center", "start", "end"] as const) {
      expect(scrollIntoViewCycle(v, y)).toEqual({ handled: false, measured: false });
    }
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("leaves horizontally scrollable content to CodeMirror's own scrolling", () => {
    // There is nothing to guard against any more — the handler never claims the scroll
    // — so the vertical refinement applies here too.
    const v = build(true, { scrollWidth: 2000, clientWidth: 600 });
    expect(scrollIntoViewCycle(v).handled).toBe(false);
    expect(v.scrollDOM.scrollTop).toBe(1177);
  });

  it("does nothing while the viewport is unmeasured (clientHeight 0)", () => {
    const v = build(true, { clientHeight: 0 });
    expect(scrollIntoViewCycle(v).measured).toBe(true);
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("reads the caret's own row, never the whole line block, inside a wrapped paragraph", () => {
    // Regression, round-2 review: anchoring on lineBlockAt().bottom scrolled by the
    // PARAGRAPH's bottom, so a caret on an early row of a 13-row paragraph was flung off
    // the TOP of the screen (measured live: y=33 -> y=-47 on a 579px phone viewport,
    // flickering on every keystroke). Same paragraph here — block 33..386 — with the
    // caret on its FIRST row, already above the anchor: nothing may move.
    const v = build(true, { caret: { top: 33, bottom: 60 } });
    expect(scrollIntoViewCycle(v).measured).toBe(true);
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("does the measuring in the measure phase, where coordsAtPos is legal", () => {
    // The OTHER bug this file has seen: calling coordsAtPos from the scroll handler
    // itself throws ("Reading the editor layout isn't allowed during an update"),
    // CodeMirror swallows the exception, and the feature silently does nothing. Assert
    // the handler itself touches no layout-reading API.
    const v = build(true);
    let calledFromHandler = 0;
    v.coordsAtPos = () => {
      calledFromHandler++;
      return { top: 700, bottom: 720, left: 0, right: 1 };
    };
    runScrollHandlers(v); // the handler alone — no measure drain
    expect(calledFromHandler).toBe(0);
  });

  it("setTypewriter reconfigures a live editor in both directions", () => {
    const v = build(true);
    expect(v.state.facet(typewriterConfig).enabled).toBe(true);

    setTypewriter(v, false);
    expect(v.state.facet(typewriterConfig).enabled).toBe(false);
    expect(scrollIntoViewCycle(v).measured).toBe(false);
    expect(v.scrollDOM.scrollTop).toBe(1000);

    setTypewriter(v, true);
    expect(v.state.facet(typewriterConfig).enabled).toBe(true);
    expect(scrollIntoViewCycle(v).measured).toBe(true);
    expect(v.scrollDOM.scrollTop).toBe(1177);
  });

  it("only depends on public CodeMirror APIs, checked on an unstubbed view", () => {
    // So a CodeMirror upgrade that renames or removes one of them fails here instead
    // of silently disabling the feature at runtime.
    const v = new EditorView({
      state: EditorState.create({
        doc: "a\nb",
        extensions: editorExtensions(true, "clean", { style: "spaces", width: 2 }, true, undefined, true),
      }),
      parent: document.body,
    });
    view = v;
    expect(typeof v.coordsAtPos).toBe("function");
    expect(typeof v.requestMeasure).toBe("function");
    expect(v.state.facet(EditorView.scrollHandler).length).toBe(1);
  });

  it("contributes NO scrollMargins — that facet also drives paging and drag-select", () => {
    // Regression guard. The first implementation reserved half the viewport as a
    // bottom scrollMargin, which silently broke three unrelated consumers of the same
    // facet: pageInfo() subtracts the margins from the PageUp/PageDown distance
    // (@codemirror/commands), MouseSelection.move() uses margins.bottom as its
    // drag-autoscroll trigger line (so dragging past the midpoint auto-scrolled at
    // 8px every 50ms), and tooltip placement shrinks its available space by it.
    const v = build(true);
    const margins = v.state.facet(EditorView.scrollMargins).map((f) => f(v));
    for (const m of margins) {
      expect(m?.top ?? 0).toBe(0);
      expect(m?.bottom ?? 0).toBe(0);
    }
  });
});

/**
 * The tests above call the handler directly. These drive CodeMirror's REAL path —
 * `dispatch({scrollIntoView: true})` -> `viewState.scrollTarget` -> `view.measure()` ->
 * `docView.scrollIntoView` -> handler -> measure request -> write.
 *
 * That matters because CodeMirror wraps scroll handlers in try/`logException`: one that
 * throws is silently treated as declined, which is invisible to a direct call. Both bugs
 * this feature shipped during development were of exactly that shape.
 *
 * The assertion is on the SEQUENCE of scrollTop writes rather than the final value:
 * happy-dom has no real line heights, so CodeMirror's scroll-anchoring correction adds a
 * fixed offset of its own afterwards. What is being tested is that our centring reached
 * the scroller through CodeMirror's own machinery. `view.measure()` is @internal, hence
 * the cast; it is the only way to flush a measure cycle without an animation frame.
 */
describe("[REQ-SCROLL-1] typewriter through CodeMirror's real scroll path", () => {
  const ANCHORED = 1177; // caret 1700px down a document, 800px viewport, anchor 2/3

  function buildReal(caretDocY: number, boxTop: number) {
    const v = new EditorView({
      state: EditorState.create({
        doc: Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n"),
        extensions: editorExtensions(true, "clean", { style: "spaces", width: 2 }, true, undefined, true),
      }),
      parent: document.body,
    });
    let top = 1000;
    const writes: number[] = [];
    Object.defineProperties(v.scrollDOM, {
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (n: number) => {
          top = n;
          writes.push(Math.round(n));
        },
      },
      clientHeight: { configurable: true, get: () => 800 },
      scrollHeight: { configurable: true, get: () => 10000 },
      clientWidth: { configurable: true, get: () => 600 },
      scrollWidth: { configurable: true, get: () => 600 },
    });
    // A non-zero box top so the client-coordinate transform (coords.top - boxTop) is
    // exercised instead of cancelling out against a 0.
    v.scrollDOM.getBoundingClientRect = () =>
      ({ top: boxTop, bottom: boxTop + 800, height: 800 }) as DOMRect;
    v.coordsAtPos = () => {
      const y = boxTop + caretDocY - v.scrollDOM.scrollTop;
      return { top: y, bottom: y + 20, left: 0, right: 1 };
    };
    view = v;
    return { view: v, writes };
  }

  /** Dispatch with scrollIntoView and flush the measure cycle CodeMirror schedules. */
  function scrollIntoViewForReal(v: EditorView) {
    v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true });
    (v as unknown as { measure(flush?: boolean): void }).measure(false);
  }

  it("settles the caret through CodeMirror's own scroll machinery", () => {
    const { view: v, writes } = buildReal(1700, 60);
    scrollIntoViewForReal(v);
    expect(writes).toContain(ANCHORED);
  });

  it("catches a handler that throws — CodeMirror swallows it, so nothing settles", () => {
    // Sanity-check that the assertion above can actually fail, by reproducing the
    // readMeasured exception the first scrollHandler version raised. CodeMirror logs it
    // and moves on, so the ONLY symptom is the missing centring.
    const { view: v, writes } = buildReal(1700, 60);
    v.coordsAtPos = (() => {
      throw new Error("Reading the editor layout isn't allowed during an update");
    }) as unknown as EditorView["coordsAtPos"];
    scrollIntoViewForReal(v);
    expect(writes).not.toContain(ANCHORED);
  });

  it("writes nothing of its own when the caret's row is already above the anchor", () => {
    // Caret 1100px down with scrollTop 1000 and a 60px box top -> row at 100..120,
    // comfortably above the 533px anchor. Our target for that geometry would
    // be 710; it must never appear.
    const { view: v, writes } = buildReal(1100, 60);
    scrollIntoViewForReal(v);
    expect(writes).not.toContain(710);
  });
});
