import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import {
  EditorSelection,
  RangeSet,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";

/**
 * Horizontal rule (`---` / `***` / `___`, SPEC §5.1). In Clean (Formatted) mode
 * the rule line is replaced by a BLOCK divider widget; in Syntax mode the chars
 * are greyed like other syntax tokens; in Source mode the literal chars stay.
 * Clean mode reveals the literal chars when the caret is on the rule line.
 *
 * It's a **block** widget (provided from a StateField, like tables) rather than
 * an inline one so a click anywhere on the line hits the widget — an inline
 * widget left clicks in the line's padding to CodeMirror, which placed the caret
 * at the line start (the "sometimes lands at the beginning" bug). Clicking the
 * divider deterministically drops the caret at the END of the rule line.
 *
 * The frontmatter `---` at the top of a document is a `Frontmatter` node, not a
 * `HorizontalRule`, so it is never matched here.
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
    s.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
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
  deco: DecorationSet;
  /** Clean-mode hidden rule ranges → EditorView.atomicRanges (arrow-skip / single delete). */
  hidden: RangeSet<Decoration>;
}
const EMPTY: HrDecos = { deco: Decoration.none, hidden: RangeSet.empty };

function computeHrDecos(state: EditorState): HrDecos {
  const mode = state.facet(renderMode);
  if (mode === "markers-rendered") return EMPTY; // Source: leave the literal chars
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];

  // Reveal-on-cursor (Clean only): a caret on the rule's line shows the chars.
  const caretLines = new Set<number>();
  if (mode === "clean") {
    for (const r of state.selection.ranges) {
      caretLines.add(state.doc.lineAt(r.from).number);
      caretLines.add(state.doc.lineAt(r.to).number);
    }
  }

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "HorizontalRule") return;
      if (mode === "markers-syntax") {
        decos.push(syntaxMark.range(node.from, node.to));
        return;
      }
      // Clean mode.
      const line = state.doc.lineAt(node.from);
      if (caretLines.has(line.number)) return; // reveal the literal chars
      decos.push(
        Decoration.replace({ widget: new HrWidget(line.to), block: true }).range(line.from, line.to),
      );
      hidden.push(hide.range(line.from, line.to));
    },
  });
  return { deco: Decoration.set(decos, true), hidden: RangeSet.of(hidden, true) };
}

// Block (line-spanning) replace decorations can't come from a ViewPlugin — the
// editor needs them before computing vertical layout — so this is a StateField,
// like tables.ts.
const hrField = StateField.define<HrDecos>({
  create: computeHrDecos,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.startState.facet(renderMode) !== tr.state.facet(renderMode) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return computeHrDecos(tr.state);
    }
    return value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).hidden),
  ],
});

export const hrExtension: Extension = hrField;
