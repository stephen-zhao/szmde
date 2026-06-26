import { EditorView } from "@codemirror/view";
import { Compartment, Facet } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";

/**
 * The three WYSIWYG render modes (SPEC §4.1):
 * - clean            — all markdown markers hidden (pure WYSIWYG; reveal-on-cursor)
 * - markers-rendered — markers shown, styled like the text they format
 * - markers-syntax   — markers shown as small greyed-out syntax tokens
 *
 * The mode is editor-wide state with no per-position data, so it's a Facet
 * behind a Compartment (mirroring the M0 code-wrap default), not a StateField.
 */
export type RenderMode = "clean" | "markers-rendered" | "markers-syntax";

export const MODE_ORDER: RenderMode[] = ["clean", "markers-rendered", "markers-syntax"];

// Single-word display names. Internal ids stay descriptive (clean / markers-*).
export const MODE_LABELS: Record<RenderMode, string> = {
  clean: "Formatted",
  "markers-rendered": "Source",
  "markers-syntax": "Syntax",
};

export const renderMode = Facet.define<RenderMode, RenderMode>({
  combine: (vals) => (vals.length ? vals[0] : "clean"),
});

export const renderModeCompartment = new Compartment();

/** Adds a `cm-clean` class to the content element while in clean mode, so CSS
 *  affordances that only make sense when markers are hidden (e.g. list bullets)
 *  can be gated on it. */
export const cleanModeContentAttr = EditorView.contentAttributes.compute(
  [renderMode],
  (state): Record<string, string> =>
    state.facet(renderMode) === "clean" ? { class: "cm-clean" } : {},
);

export function renderModeOf(state: EditorState): RenderMode {
  return state.facet(renderMode);
}

export function setRenderMode(view: EditorView, mode: RenderMode) {
  view.dispatch({
    effects: renderModeCompartment.reconfigure(renderMode.of(mode)),
  });
}

/** Command: cycle clean → markers-rendered → markers-syntax → clean. */
export function cycleRenderMode(view: EditorView): boolean {
  const cur = renderModeOf(view.state);
  const next = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % MODE_ORDER.length];
  setRenderMode(view, next);
  return true;
}
