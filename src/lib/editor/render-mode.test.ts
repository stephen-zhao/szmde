import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  MODE_ORDER,
  MODE_LABELS,
  renderModeOf,
  setRenderMode,
  cycleRenderMode,
  type RenderMode,
} from "./render-mode";
import { editorExtensions } from "./setup";

// These drive the render-mode compartment/commands through a REAL EditorView
// (built with the full editor extension set, which wires renderModeCompartment +
// cleanModeContentAttr). The contract under test: the cycle ORDER (and its wrap)
// and the clean-mode content-class gating — both must regress-fail here.
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(mode: RenderMode = "clean"): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc: "# Heading\n\nbody",
      extensions: editorExtensions(true, mode),
    }),
    parent: document.body,
  });
  view = v;
  return v;
}

describe("[REQ-RENDER-1] MODE_ORDER / MODE_LABELS — the three modes", () => {
  it("orders the modes clean → markers-rendered → markers-syntax", () => {
    expect(MODE_ORDER).toEqual(["clean", "markers-rendered", "markers-syntax"]);
  });

  it("gives every mode exactly one single-word label", () => {
    // One label per mode, no missing/extra keys.
    expect(Object.keys(MODE_LABELS).sort()).toEqual([...MODE_ORDER].sort());
    for (const mode of MODE_ORDER) {
      const label = MODE_LABELS[mode];
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain(" "); // single word
    }
  });

  it("labels each mode with its expected word", () => {
    // Pin the actual user-facing words so a relabel is a deliberate change.
    expect(MODE_LABELS.clean).toBe("Formatted");
    expect(MODE_LABELS["markers-rendered"]).toBe("Source");
    expect(MODE_LABELS["markers-syntax"]).toBe("Syntax");
  });
});

describe("renderModeOf — default", () => {
  it("defaults to clean when the facet is unset", () => {
    // A bare state with no render-mode extension still resolves to clean via the
    // facet's combine fallback.
    const state = EditorState.create({ doc: "x" });
    expect(renderModeOf(state)).toBe("clean");
  });
});

describe("setRenderMode — reconfigures the compartment per mode", () => {
  it("switches renderModeOf(view.state) to each mode it's given", () => {
    const v = build("clean");
    expect(renderModeOf(v.state)).toBe("clean");

    for (const mode of MODE_ORDER) {
      setRenderMode(v, mode);
      expect(renderModeOf(v.state)).toBe(mode);
    }

    // And back to a non-adjacent mode to prove it's a real set, not a step.
    setRenderMode(v, "clean");
    expect(renderModeOf(v.state)).toBe("clean");
  });
});

describe("[REQ-RENDER-7] cycleRenderMode — advances through MODE_ORDER and wraps", () => {
  it("steps clean → markers-rendered → markers-syntax → clean (full loop)", () => {
    const v = build("clean");
    expect(renderModeOf(v.state)).toBe("clean");

    // Walk the entire cycle one extra step so the final wrap-around is asserted.
    const seen: RenderMode[] = [renderModeOf(v.state)];
    for (let i = 0; i < MODE_ORDER.length; i++) {
      const handled = cycleRenderMode(v);
      expect(handled).toBe(true); // it's a command: claims the key
      seen.push(renderModeOf(v.state));
    }

    // clean → rendered → syntax → clean: each step is the next in order, and the
    // last lands back on the first (wrap). A reordered MODE_ORDER or a wrap that
    // overshoots/clamps fails this exact sequence.
    expect(seen).toEqual([
      "clean",
      "markers-rendered",
      "markers-syntax",
      "clean",
    ]);
  });

  it("wraps from the last mode back to the first", () => {
    const v = build("markers-syntax"); // start ON the last entry
    expect(renderModeOf(v.state)).toBe("markers-syntax");
    cycleRenderMode(v);
    expect(renderModeOf(v.state)).toBe(MODE_ORDER[0]); // not stuck/clamped at the end
    expect(renderModeOf(v.state)).toBe("clean");
  });
});

describe("cleanModeContentAttr — clean-mode content class gating", () => {
  const hasCleanClass = (v: EditorView) =>
    v.contentDOM.classList.contains("cm-clean");

  it("adds the cm-clean class on the content element ONLY in clean mode", () => {
    const v = build("clean");
    expect(hasCleanClass(v)).toBe(true);

    setRenderMode(v, "markers-rendered");
    expect(hasCleanClass(v)).toBe(false);

    setRenderMode(v, "markers-syntax");
    expect(hasCleanClass(v)).toBe(false);

    // Returning to clean must re-add it (the attr is recomputed from the facet).
    setRenderMode(v, "clean");
    expect(hasCleanClass(v)).toBe(true);
  });

  it("does not add cm-clean when an editor is built in a marker mode", () => {
    const v = build("markers-rendered");
    expect(hasCleanClass(v)).toBe(false);
  });
});
