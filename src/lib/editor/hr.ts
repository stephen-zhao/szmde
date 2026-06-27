import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { EditorSelection, RangeSet, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";

/**
 * Horizontal rule (`---` / `***` / `___`, SPEC §5.1). In Clean (Formatted) mode
 * the marker run is replaced by a divider widget; in Syntax mode the chars are
 * greyed like other syntax tokens; in Source mode the literal chars stay as-is.
 * Clean mode reveals the literal chars when the caret is on the rule line (so it
 * stays editable), exactly like the M1 heading/quote marker reveal.
 *
 * The frontmatter `---` at the top of a document is a `Frontmatter` node, not a
 * `HorizontalRule`, so it is never matched here — a YAML preamble never renders
 * as a rule.
 */
class HrWidget extends WidgetType {
  constructor(readonly to: number) {
    super();
  }
  eq(o: HrWidget) {
    return o.to === this.to;
  }
  toDOM(view: EditorView) {
    const s = document.createElement("span");
    s.className = "cm-md-hr";
    s.setAttribute("aria-hidden", "true");
    // Clicking the divider reveals the literal `---` with the caret deterministically
    // at the END of the line (CM would otherwise pick start/end by click x-position).
    s.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.to), scrollIntoView: true });
      view.focus();
    });
    return s;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

const hide = Decoration.replace({});
const syntaxMark = Decoration.mark({ class: "cm-md-mark-syntax" });

interface HrDecos {
  decorations: DecorationSet;
  /** Clean-mode hidden rule ranges, fed to EditorView.atomicRanges so arrows
   *  skip the divider and a single delete removes the whole rule. */
  hidden: RangeSet<Decoration>;
}

function buildHrDecos(view: EditorView): HrDecos {
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const { state } = view;
  const mode = state.facet(renderMode);

  // Reveal-on-cursor (Clean mode only): a caret on the rule's line shows the
  // literal chars instead of the widget.
  const caretLines = new Set<number>();
  if (mode === "clean") {
    for (const sel of state.selection.ranges) {
      caretLines.add(state.doc.lineAt(sel.from).number);
      caretLines.add(state.doc.lineAt(sel.to).number);
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "HorizontalRule") return;
        if (mode === "clean") {
          if (caretLines.has(state.doc.lineAt(node.from).number)) return; // reveal
          decos.push(Decoration.replace({ widget: new HrWidget(node.to) }).range(node.from, node.to));
          hidden.push(hide.range(node.from, node.to));
        } else if (mode === "markers-syntax") {
          decos.push(syntaxMark.range(node.from, node.to));
        }
        // markers-rendered: leave the literal chars untouched.
      },
    });
  }
  return {
    decorations: Decoration.set(decos, true),
    hidden: RangeSet.of(hidden, true),
  };
}

export const hrDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hidden: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const r = buildHrDecos(view);
      this.decorations = r.decorations;
      this.hidden = r.hidden;
    }
    update(u: ViewUpdate) {
      const cleanNow = u.state.facet(renderMode) === "clean";
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.facet(renderMode) !== u.state.facet(renderMode) ||
        (cleanNow && u.selectionSet) || // reveal-on-cursor rebuild (Clean only)
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        const r = buildHrDecos(u.view);
        this.decorations = r.decorations;
        this.hidden = r.hidden;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Make the Clean-mode divider atomic: arrows skip it and one delete removes it. */
export const hrAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(hrDecorations)?.hidden ?? RangeSet.empty,
);
