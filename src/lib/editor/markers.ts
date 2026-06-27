import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSet, type Range } from "@codemirror/state";
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

/**
 * An invisible clone of a list item's marker prefix, used in Formatted mode to
 * indent a soft-broken CONTINUATION line so its text aligns exactly under the
 * item's content. Literal spaces can't do this — the rendered `•` (or number)
 * is a different width than a space, and that width is font-dependent. Cloning
 * the real prefix glyphs (same CSS classes) with `visibility:hidden` guarantees
 * a pixel-perfect match in any font, present or future.
 */
class HangIndentWidget extends WidgetType {
  constructor(
    readonly leading: string, // nesting whitespace before the marker
    readonly glyph: string, // "•" for bullets, or the ordered number+delimiter
    readonly glyphClass: string, // same class as the real marker, so styling matches
    readonly trailing: string, // whitespace between marker and content
  ) {
    super();
  }
  eq(o: HangIndentWidget) {
    return (
      o.leading === this.leading &&
      o.glyph === this.glyph &&
      o.glyphClass === this.glyphClass &&
      o.trailing === this.trailing
    );
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-hang-indent";
    wrap.setAttribute("aria-hidden", "true");
    if (this.leading) wrap.appendChild(document.createTextNode(this.leading));
    const g = document.createElement("span");
    g.className = this.glyphClass;
    g.textContent = this.glyph;
    wrap.appendChild(g);
    if (this.trailing) wrap.appendChild(document.createTextNode(this.trailing));
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** The leading `indent + marker + trailing space(s)` of a list item line. */
const LIST_PREFIX = /^(\s*)((?:[-*+])|(?:\d+[.)]))(\s+)/;

/**
 * Push hang-indent decorations for a list item's continuation lines (Formatted
 * mode only): each line of the item's own paragraph(s) AFTER the first has its
 * leading whitespace replaced by an invisible marker-prefix clone, aligning the
 * text under the content. Nested child lists are skipped (their lines carry
 * their own markers, handled elsewhere).
 */
function pushHangIndents(
  item: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>,
  state: EditorView["state"],
  decos: Range<Decoration>[],
  hiddenRanges: Range<Decoration>[],
) {
  if (!item.getChild("ListMark")) return;
  const pfx = LIST_PREFIX.exec(state.doc.lineAt(item.from).text);
  if (!pfx) return;
  const ordered = item.parent?.name === "OrderedList";
  const widget = new HangIndentWidget(
    pfx[1],
    ordered ? pfx[2] : "•",
    ordered ? "cm-md-list-number" : "cm-md-bullet",
    pfx[3],
  );
  const replace = Decoration.replace({ widget });
  for (const para of item.getChildren("Paragraph")) {
    const startLine = state.doc.lineAt(para.from).number;
    const endLine = state.doc.lineAt(para.to).number;
    for (let ln = startLine + 1; ln <= endLine; ln++) {
      const line = state.doc.line(ln);
      const ws = /^[ \t]*/.exec(line.text)![0].length;
      if (ws === 0) continue; // a col-0 lazy continuation — nothing to align over
      decos.push(replace.range(line.from, line.from + ws));
      hiddenRanges.push(hide.range(line.from, line.from + ws)); // atomic: skip/delete as a unit
    }
  }
}

interface MarkerDecos {
  decorations: DecorationSet;
  /** Clean-mode hidden marker ranges, fed to EditorView.atomicRanges so arrow
   *  keys skip them and a single delete removes the whole marker. */
  hidden: RangeSet<Decoration>;
}

function buildMarkerDecos(view: EditorView): MarkerDecos {
  // Collected unsorted and sorted at the end: hang-indent decos for a list item
  // are emitted when entering the ListItem (before its ListMark child is
  // visited), so positions don't arrive in order — a RangeSetBuilder couldn't
  // accept them.
  const decos: Range<Decoration>[] = [];
  const hiddenRanges: Range<Decoration>[] = [];
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
        if (mode === "clean" && node.name === "ListItem") {
          pushHangIndents(node.node, state, decos, hiddenRanges);
        }
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
              if (mode === "clean") decos.push(listNumberClean.range(node.from, node.to));
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
            decos.push(bullet.range(node.from, node.to)); // always-visible decorative bullet
            return;
          }
          const revealed = isBlockMark
            ? caretLines.has(state.doc.lineAt(node.from).number)
            : caretPos.some(
                (p) => p >= (parent ? parent.from : node.from) && p <= (parent ? parent.to : node.to),
              );
          if (!revealed) {
            decos.push(hide.range(node.from, node.to));
            hiddenRanges.push(hide.range(node.from, node.to));
          }
          // revealed → emit nothing: the literal marker shows as editable text.
        } else if (mode === "markers-syntax") {
          decos.push(syntaxMark.range(node.from, node.to));
        } else if (rendered) {
          decos.push(renderedMarks[rendered].range(node.from, node.to));
        }
      },
    });
  }
  return {
    decorations: Decoration.set(decos, true),
    hidden: RangeSet.of(hiddenRanges, true),
  };
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
