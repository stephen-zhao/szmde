import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSet, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";

/** A decorative bullet shown in Clean (Formatted) mode in place of a literal
 *  unordered-list marker (a dash, asterisk, or plus). List markers are semantic
 *  content, not pure syntax, so they stay visible (just rendered) not hidden. */
class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-bullet";
    s.textContent = "•";
    return s;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });

const hide = Decoration.replace({});
const syntaxMark = Decoration.mark({ class: "cm-md-mark-syntax" });
const renderedMarks: Record<string, Decoration> = {
  "cm-mk-strong": Decoration.mark({ class: "cm-mk-strong" }),
  "cm-mk-em": Decoration.mark({ class: "cm-mk-em" }),
  "cm-mk-strike": Decoration.mark({ class: "cm-mk-strike" }),
  "cm-mk-code": Decoration.mark({ class: "cm-mk-code" }),
};
// In Formatted mode an ordered-list number is real content, not syntax — render
// it in normal text color, overriding lezer's muted processingInstruction tag.
const listNumberClean = Decoration.mark({ class: "cm-md-list-number" });

interface MarkerDecos {
  decorations: DecorationSet;
  /** Clean-mode hidden marker ranges, fed to EditorView.atomicRanges so arrow
   *  keys skip them and a single delete removes the whole marker. */
  hidden: RangeSet<Decoration>;
}

function buildMarkerDecos(view: EditorView): MarkerDecos {
  const decoB = new RangeSetBuilder<Decoration>();
  const hiddenB = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const mode = state.facet(renderMode);

  // Reveal-on-cursor (Formatted mode only): block marks reveal on the caret's
  // line; inline marks reveal when a caret is within their construct.
  const caretLines = new Set<number>();
  const caretPos: number[] = [];
  if (mode === "clean") {
    for (const sel of state.selection.ranges) {
      caretLines.add(state.doc.lineAt(sel.from).number);
      caretLines.add(state.doc.lineAt(sel.to).number);
      caretPos.push(sel.from);
      if (sel.to !== sel.from) caretPos.push(sel.to);
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const parent = node.node.parent;
        const parentName = parent?.name;
        let rendered: string | null | undefined; // undefined = unmanaged
        let isBullet = false;
        let isBlockMark = false; // heading/quote marker — reveals per line
        switch (node.name) {
          case "EmphasisMark":
            rendered =
              parentName === "StrongEmphasis"
                ? "cm-mk-strong"
                : parentName === "Emphasis"
                  ? "cm-mk-em"
                  : undefined;
            break;
          case "StrikethroughMark":
            rendered = "cm-mk-strike";
            break;
          case "CodeMark":
            rendered = parentName === "InlineCode" ? "cm-mk-code" : undefined; // skip fenced
            break;
          case "HeaderMark":
          case "QuoteMark":
            rendered = null;
            isBlockMark = true;
            break;
          case "ListMark":
            if (parent?.parent?.name === "OrderedList") {
              if (mode === "clean") decoB.add(node.from, node.to, listNumberClean);
              return;
            }
            rendered = null;
            isBullet = true;
            break;
          default:
            rendered = undefined;
        }
        if (rendered === undefined && !isBullet) return;

        if (mode === "clean") {
          if (isBullet) {
            decoB.add(node.from, node.to, bullet); // always-visible decorative bullet
            return;
          }
          const revealed = isBlockMark
            ? caretLines.has(state.doc.lineAt(node.from).number)
            : caretPos.some(
                (p) => p >= (parent ? parent.from : node.from) && p <= (parent ? parent.to : node.to),
              );
          if (!revealed) {
            decoB.add(node.from, node.to, hide);
            hiddenB.add(node.from, node.to, hide);
          }
          // revealed → emit nothing: the literal marker shows as editable text.
        } else if (mode === "markers-syntax") {
          decoB.add(node.from, node.to, syntaxMark);
        } else if (rendered) {
          decoB.add(node.from, node.to, renderedMarks[rendered]);
        }
      },
    });
  }
  return { decorations: decoB.finish(), hidden: hiddenB.finish() };
}

export const markerDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hidden: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const r = buildMarkerDecos(view);
      this.decorations = r.decorations;
      this.hidden = r.hidden;
    }
    update(u: ViewUpdate) {
      const cleanNow = u.state.facet(renderMode) === "clean";
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.facet(renderMode) !== u.state.facet(renderMode) ||
        (cleanNow && u.selectionSet) || // reveal-on-cursor rebuild (Formatted mode only)
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        const r = buildMarkerDecos(u.view);
        this.decorations = r.decorations;
        this.hidden = r.hidden;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Make Formatted-mode hidden markers atomic: arrow keys skip over them and a
 *  single Backspace/Delete removes the whole marker rather than landing in the
 *  zero-width gap left by the replace decoration. */
export const markerAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(markerDecorations)?.hidden ?? RangeSet.empty,
);
