import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState, EditorSelection } from "@codemirror/state";
import { editorExtensions } from "./setup";
import { setTypewriter, typewriterEnabled } from "./typewriter";

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
  /** Caret coords, in px from the top of the scroller's box. null = unmeasurable. */
  caret?: { top: number; bottom: number } | null;
};

/**
 * happy-dom reports 0 for every layout box and has no caret geometry, so the
 * scroller metrics and `coordsAtPos` have to be stubbed. Everything above them —
 * the facet, the handler registration, the branch logic — is the real thing.
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
  it("takes over the scroll and centres the caret line when it is below the midpoint", () => {
    const v = build(true);
    expect(runScrollHandlers(v)).toBe(true); // handled -> CodeMirror does not scroll again
    expect(v.scrollDOM.scrollTop).toBe(1310);
  });

  it("declines when the caret is at or above the midpoint", () => {
    const v = build(true, { caret: { top: 100, bottom: 120 } });
    expect(runScrollHandlers(v)).toBe(false);
    expect(v.scrollDOM.scrollTop).toBe(1000); // untouched — CM's minimal scrolling runs
  });

  it("declines when the setting is off", () => {
    const v = build(false);
    expect(runScrollHandlers(v)).toBe(false);
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("declines for an explicit scroll strategy, so y:'center'/'start'/'end' are honoured", () => {
    // Any caller that asks for a specific placement must land where THEY asked, not
    // where the typewriter would have put it.
    const v = build(true);
    expect(runScrollHandlers(v, "center")).toBe(false);
    expect(runScrollHandlers(v, "start")).toBe(false);
    expect(runScrollHandlers(v, "end")).toBe(false);
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("declines when the content can scroll horizontally", () => {
    // Handling the scroll suppresses CodeMirror's HORIZONTAL scrolling too, which
    // would strand the caret off the right edge. (lineWrapping is on, so this guards
    // a future config rather than today's default.)
    const v = build(true, { scrollWidth: 2000, clientWidth: 600 });
    expect(runScrollHandlers(v)).toBe(false);
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("declines while the viewport is unmeasured (clientHeight 0)", () => {
    const v = build(true, { clientHeight: 0 });
    expect(runScrollHandlers(v)).toBe(false);
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("declines when the caret has no coordinates", () => {
    const v = build(true, { caret: null });
    expect(runScrollHandlers(v)).toBe(false);
    expect(v.scrollDOM.scrollTop).toBe(1000);
  });

  it("setTypewriter reconfigures a live editor in both directions", () => {
    const v = build(true);
    expect(v.state.facet(typewriterEnabled)).toBe(true);

    setTypewriter(v, false);
    expect(v.state.facet(typewriterEnabled)).toBe(false);
    expect(runScrollHandlers(v)).toBe(false);

    setTypewriter(v, true);
    expect(v.state.facet(typewriterEnabled)).toBe(true);
    expect(runScrollHandlers(v)).toBe(true);
    expect(v.scrollDOM.scrollTop).toBe(1310);
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
