import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { editorExtensions } from "./setup";
import { DEFAULT_LANE_OPEN, laneOpenField, setLaneOpen, type LaneOpen } from "./lane-drawers";

// happy-dom gives real elements whose inline CSS custom properties we can read back,
// and a real StateField/ViewPlugin lifecycle. Layout boxes are all 0 and there is no
// caret geometry, so the tween's requestMeasure is a no-op here (it forces CM's
// measure pass, which needs real layout — exercised live in WF-39); everything else
// — the seed, the field, the effect merge, the DOM var writes, the rAF loop — is the
// real thing, driven deterministically by stubbing requestAnimationFrame.

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  vi.unstubAllGlobals();
});

/** Build an editor with an optional lane-open seed (the 8th editorExtensions arg). */
function build(seed?: LaneOpen): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc: "# Heading\n\ntext",
      extensions: editorExtensions(
        true,
        "clean",
        { style: "spaces", width: 2 },
        true,
        undefined,
        true,
        undefined,
        seed,
      ),
    }),
    parent: document.body,
  });
  view = v;
  return v;
}

// The plugin writes the scalars on the OUTER .cm-editor (view.dom); they inherit
// down to .cm-content's padding calc. (contentDOM is off-limits — CM rebuilds its
// style.cssText in updateAttrs on init/setState.)
const openVar = (v: EditorView, name: string) => v.dom.style.getPropertyValue(name);

/** A manual requestAnimationFrame queue so the tween runs deterministically. Must be
 *  installed AFTER `build()` so CodeMirror's construction uses the real rAF. */
function installFrameQueue(): { drain: (max?: number) => number; pending: () => number } {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return {
    drain(max = 100) {
      let n = 0;
      while (frames.length && n < max) {
        frames.shift()!(0);
        n++;
      }
      return n;
    },
    pending: () => frames.length,
  };
}

describe("[REQ-LANE-4] laneDrawers — seed → field + contentDOM vars", () => {
  it("defaults to all-open (byte-identical to the pre-drawer layout)", () => {
    const v = build();
    expect(v.state.field(laneOpenField)).toEqual(DEFAULT_LANE_OPEN);
    // width×1 ⇒ the calc collapses to the reserved width, exactly as before.
    expect(openVar(v, "--fold-open")).toBe("1");
    expect(openVar(v, "--marker-open")).toBe("1");
  });

  it("seeds the field AND writes the seed vars on contentDOM synchronously", () => {
    const v = build({ fold: 0, marker: 0.5 });
    expect(v.state.field(laneOpenField)).toEqual({ fold: 0, marker: 0.5 });
    expect(openVar(v, "--fold-open")).toBe("0");
    expect(openVar(v, "--marker-open")).toBe("0.5");
  });

  it("clamps an out-of-range seed to [0,1]", () => {
    const v = build({ fold: 1.5, marker: -1 });
    expect(v.state.field(laneOpenField)).toEqual({ fold: 1, marker: 0 });
  });
});

describe("[REQ-LANE-4] laneDrawers — setLaneOpen target field", () => {
  it("merges + clamps setLaneOpen into the target, leaving untouched lanes alone", () => {
    const v = build({ fold: 1, marker: 1 });
    v.dispatch({ effects: setLaneOpen.of({ open: { fold: 1.5 }, animate: false }) }); // clamps to 1
    expect(v.state.field(laneOpenField)).toEqual({ fold: 1, marker: 1 });
    v.dispatch({ effects: setLaneOpen.of({ open: { marker: -1 }, animate: false }) }); // clamps to 0
    expect(v.state.field(laneOpenField)).toEqual({ fold: 1, marker: 0 });
  });

  it("keeps the SAME field reference across a non-lane transaction", () => {
    // The plugin compares field references to decide whether to (re)tween, so an
    // unrelated edit must not produce a new object.
    const v = build();
    const before = v.state.field(laneOpenField);
    v.dispatch({ changes: { from: v.state.doc.length, insert: "!" } });
    expect(v.state.field(laneOpenField)).toBe(before);
  });
});

const captureMeasures = (v: EditorView) => {
  const measures: Array<{ read: (v: EditorView) => unknown; write: (r: unknown, v: EditorView) => void }> = [];
  v.requestMeasure = ((req?: (typeof measures)[number]) => {
    if (req) measures.push(req);
  }) as EditorView["requestMeasure"];
  return measures;
};

describe("[REQ-LANE-4] laneDrawers — snap vs. tween (caller-driven)", () => {
  it("SNAPS instantly when animate:false (initial/breakpoint seed — no cold-load slide)", () => {
    const v = build(); // all open
    const q = installFrameQueue();
    const measures = captureMeasures(v);
    v.dispatch({ effects: setLaneOpen.of({ open: { fold: 0, marker: 0 }, animate: false }) });
    expect(openVar(v, "--fold-open")).toBe("0");
    expect(openVar(v, "--marker-open")).toBe("0");
    expect(q.drain()).toBe(0); // no frame scheduled — it snapped
    expect(measures.length).toBe(1); // one re-measure for the snap
    for (const m of measures) m.write(m.read(v), v); // covers the no-op read/write
  });

  it("TWEENS over frames when animate:true (a user toggle), re-measuring each frame", () => {
    const v = build(); // all open
    const q = installFrameQueue();
    const measures = captureMeasures(v);
    v.dispatch({ effects: setLaneOpen.of({ open: { fold: 0 }, animate: true }) });
    expect(v.state.field(laneOpenField).fold).toBe(0); // target set synchronously
    const frames = q.drain();
    expect(frames).toBeGreaterThan(1); // it actually animated over multiple frames
    expect(openVar(v, "--fold-open")).toBe("0"); // settled exactly on target
    expect(openVar(v, "--marker-open")).toBe("1"); // the other lane never moved
    expect(measures.length).toBe(frames); // one keyed re-measure per frame
    for (const m of measures) m.write(m.read(v), v);
  });

  it("snap-vs-tween follows the CALLER even after the plugin is recreated (setState)", () => {
    // Regression (adversarial review): snap-vs-tween must be the caller's `animate`,
    // NOT plugin-instance state — else the first toggle after a file open (which
    // recreates the plugin) would wrongly snap instead of animating.
    const v = build({ fold: 0, marker: 0 }); // start collapsed
    v.setState(
      EditorState.create({
        doc: "x",
        extensions: editorExtensions(
          true, "clean", { style: "spaces", width: 2 }, true, undefined, true, undefined,
          { fold: 0, marker: 0 },
        ),
      }),
    ); // simulate a file open — recreates the plugin fresh
    const q = installFrameQueue();
    v.requestMeasure = (() => {}) as EditorView["requestMeasure"];
    v.dispatch({ effects: setLaneOpen.of({ open: { fold: 1, marker: 1 }, animate: true }) });
    expect(q.drain()).toBeGreaterThan(1); // TWEENED despite being the first change post-setState
    expect(openVar(v, "--fold-open")).toBe("1");
  });

  it("coalesces rapid target changes into a single pending frame", () => {
    const v = build();
    const q = installFrameQueue();
    v.requestMeasure = (() => {}) as EditorView["requestMeasure"];
    v.dispatch({ effects: setLaneOpen.of({ open: { fold: 0 }, animate: true }) }); // schedules a frame
    v.dispatch({ effects: setLaneOpen.of({ open: { fold: 0.5 }, animate: true }) }); // frame pending → no 2nd schedule
    expect(q.pending()).toBe(1); // one frame for both; tick reads the latest target
    v.destroy();
    view = undefined;
  });

  it("cancels a pending tween frame on destroy", () => {
    const v = build();
    vi.stubGlobal("requestAnimationFrame", () => 42);
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    v.requestMeasure = (() => {}) as EditorView["requestMeasure"];
    v.dispatch({ effects: setLaneOpen.of({ open: { marker: 0 }, animate: true }) }); // schedules frame id 42
    v.destroy();
    view = undefined; // already destroyed — skip afterEach's destroy
    expect(cancel).toHaveBeenCalledWith(42);
  });
});

describe("[REQ-LANE-4] laneDrawers — survives file open (setState re-seed)", () => {
  it("re-seeds field + vars from the facet on setState (a new file re-reads the live seed)", () => {
    // Editor.svelte re-passes the LIVE lane-open through editorExtensions on every
    // buildState, so a collapse the user chose is preserved when a new file opens
    // (adversarial hole #4). Here we assert the mechanism: setState with a fresh seed
    // re-creates the field + plugin at the new value.
    const v = build({ fold: 1, marker: 1 });
    v.setState(
      EditorState.create({
        doc: "another file",
        extensions: editorExtensions(
          true,
          "clean",
          { style: "spaces", width: 2 },
          true,
          undefined,
          true,
          undefined,
          { fold: 0, marker: 0 },
        ),
      }),
    );
    expect(v.state.field(laneOpenField)).toEqual({ fold: 0, marker: 0 });
    expect(openVar(v, "--fold-open")).toBe("0");
    expect(openVar(v, "--marker-open")).toBe("0");
  });
});
