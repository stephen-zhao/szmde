import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSet, type EditorState, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";

// Nested unordered bullets cycle through these by depth (like typical editors).
const BULLETS = ["•", "◦", "▪"];

/** Bullet glyph for a node by its unordered-list nesting depth — the number of
 *  `BulletList` ancestors. Works for a ListMark (ancestors: ListItem→BulletList…)
 *  or a ListItem (ancestors: BulletList…) alike. */
function bulletGlyph(node: SyntaxNode): string {
  let depth = 0;
  for (let p: SyntaxNode | null = node.parent; p; p = p.parent)
    if (p.name === "BulletList") depth++;
  return BULLETS[(depth - 1 + BULLETS.length) % BULLETS.length];
}

/** A decorative bullet shown in Clean (Formatted) mode in place of a literal
 *  unordered-list marker (a dash, asterisk, or plus). List markers are semantic
 *  content, not pure syntax, so they stay visible (just rendered) not hidden. */
class BulletWidget extends WidgetType {
  constructor(readonly glyph: string) {
    super();
  }
  /* v8 ignore start -- bullet decorations are cached per glyph (below), so the
     old/new widget is the SAME instance across rebuilds → CM short-circuits on
     reference equality and never calls eq; defensive only. */
  eq(o: BulletWidget) {
    return o.glyph === this.glyph;
  }
  /* v8 ignore stop */
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-bullet";
    s.textContent = this.glyph;
    return s;
  }
}
const bulletCache = new Map<string, Decoration>();
function bulletDeco(glyph: string): Decoration {
  let d = bulletCache.get(glyph);
  if (!d) bulletCache.set(glyph, (d = Decoration.replace({ widget: new BulletWidget(glyph) })));
  return d;
}

// Ordered-list numbering. By ORDERED nesting depth the style cycles
// decimal → lower-alpha → lower-roman, and each list restarts: the DISPLAYED
// ordinal is the item's POSITION within its own OrderedList (not the literal
// number), so display is always correct and resets when nested.
function orderedDepth(node: SyntaxNode): number {
  let d = 0;
  for (let p: SyntaxNode | null = node.parent; p; p = p.parent)
    if (p.name === "OrderedList") d++;
  return d;
}
function orderedIndex(item: SyntaxNode): number {
  let i = 0;
  for (let c = item.parent?.firstChild ?? null; c; c = c.nextSibling) {
    if (c.name === "ListItem") {
      i++;
      if (c.from === item.from) return i;
    }
  }
  /* v8 ignore start -- defensive: an ordered item is always among its parent
     list's children, so the loop returns above; this fallback is unreachable. */
  return i || 1;
  /* v8 ignore stop */
}
function toAlpha(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];
function toRoman(n: number): string {
  let s = "";
  for (const [v, r] of ROMAN) while (n >= v) (s += r), (n -= v);
  return s;
}
function orderedLabel(depth: number, index: number): string {
  const style = (depth - 1) % 3;
  return style === 1 ? toAlpha(index) : style === 2 ? toRoman(index) : String(index);
}
/** Computed ordinal (with the item's `.`/`)` delimiter) for an ordered ListMark. */
function orderedMarkLabel(state: EditorView["state"], mark: SyntaxNode): string {
  const item = mark.parent!;
  const delim = state.doc.sliceString(mark.to - 1, mark.to) === ")" ? ")" : ".";
  return orderedLabel(orderedDepth(mark), orderedIndex(item)) + delim;
}

class OrderedNumberWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  /* v8 ignore start -- cached per label → reused by reference, eq not called. */
  eq(o: OrderedNumberWidget) {
    return o.label === this.label;
  }
  /* v8 ignore stop */
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-list-number";
    s.textContent = this.label;
    return s;
  }
}
const orderedCache = new Map<string, Decoration>();
function orderedNumberDeco(label: string): Decoration {
  let d = orderedCache.get(label);
  if (!d)
    orderedCache.set(label, (d = Decoration.replace({ widget: new OrderedNumberWidget(label) })));
  return d;
}

const hide = Decoration.replace({});
const syntaxMark = Decoration.mark({ class: "cm-md-mark-syntax" });
// RENDER-9 (Syntax mode): a block marker (#…, >) hangs in the left margin so the
// heading/quote text stays flush at the content margin. The mark is positioned
// `absolute; right:100%` in theme.ts (its own measured width sets how far it
// hangs — algorithmic, no px constant); the line decoration is the positioning
// context. The marker+trailing-space stays real/selectable (modes-2&3 rule).
const hangLine = Decoration.line({ class: "cm-md-hang-line" });

/** The hung block marker (#…/>) + its trailing space, as a single widget so it's
 *  one absolutely-positioned box (a Decoration.mark would fragment at the
 *  marker↔text highlight boundary and the pieces would overlap). RENDER-9. */
class HangMarkerWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: HangMarkerWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-mark-syntax cm-md-mark-hang";
    s.textContent = this.text;
    return s;
  }
}

/** Length of the whitespace right after a block marker (the syntactic space after
 *  `#`/`>`), so the hidden (Clean) / hung (Syntax) range reaches the content. */
function trailingWsLen(state: EditorState, from: number, to: number): number {
  const line = state.doc.lineAt(from);
  return /^[ \t]+/.exec(line.text.slice(to - line.from))?.[0].length ?? 0;
}
const renderedMarks: Record<string, Decoration> = {
  "cm-mk-strong": Decoration.mark({ class: "cm-mk-strong" }),
  "cm-mk-em": Decoration.mark({ class: "cm-mk-em" }),
  "cm-mk-strike": Decoration.mark({ class: "cm-mk-strike" }),
  "cm-mk-code": Decoration.mark({ class: "cm-mk-code" }),
};

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
  /* v8 ignore start -- CM only calls ignoreEvent on real pointer/DOM events,
     which happy-dom cannot dispatch faithfully. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
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
  if (item.getChild("Task")) return; // task items hang-indent via tasks.ts (checkbox clone)
  const pfx = LIST_PREFIX.exec(state.doc.lineAt(item.from).text);
  if (!pfx) return;
  const ordered = item.parent?.name === "OrderedList";
  const widget = new HangIndentWidget(
    pfx[1],
    ordered ? orderedMarkLabel(state, item.getChild("ListMark")!) : bulletGlyph(item),
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
            rendered = null;
            // Only the LEADING ATX marker (`#…` at the line start) hangs/flushes.
            // A setext underline (`====`/`----`) and an optional ATX closing `#`
            // are ALSO HeaderMarks but must NOT be treated as the block marker —
            // they fall through to ordinary hidden (Clean) / small-grey (Syntax).
            isBlockMark =
              parentName !== undefined &&
              /^ATXHeading[1-6]$/.test(parentName) &&
              parent !== null &&
              node.from === parent.from;
            break;
          case "QuoteMark":
            rendered = null;
            isBlockMark = true;
            break;
          case "ListMark":
            if (parent?.parent?.name === "OrderedList") {
              // Replace the literal `1.` with the computed ordinal (depth-styled,
              // position-based so nested lists restart). Like bullets, it's
              // always-shown content (edit the literal in Source/Syntax mode).
              if (mode === "clean")
                decos.push(orderedNumberDeco(orderedMarkLabel(state, node.node)).range(node.from, node.to));
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
            // Task items render a checkbox (tasks.ts), not a •; suppress the bullet.
            if (node.node.parent?.getChild("Task")) return;
            // Depth-varied glyph (•/◦/▪) so nesting reads clearly.
            decos.push(bulletDeco(bulletGlyph(node.node)).range(node.from, node.to));
            return;
          }
          const revealed = isBlockMark
            ? caretLines.has(state.doc.lineAt(node.from).number)
            : caretPos.some(
                (p) => p >= (parent ? parent.from : node.from) && p <= (parent ? parent.to : node.to),
              );
          if (!revealed) {
            let to = node.to;
            if (isBlockMark) {
              // A fully-hidden block marker's trailing space(s) are syntax too —
              // hide them so the content sits flush (no leading space) in Clean
              // mode. Applies to headings (`# `) and blockquotes (`> `). (Bullets
              // and ordered numbers keep their space — they show a glyph there.)
              to += trailingWsLen(state, node.from, node.to);
            }
            decos.push(hide.range(node.from, to));
            hiddenRanges.push(hide.range(node.from, to));
          }
          // revealed → emit nothing: the literal marker shows as editable text.
        } else if (mode === "markers-syntax") {
          if (isBlockMark) {
            // RENDER-9: hang the block marker (#…/>) + its trailing space in the
            // left margin so the heading/quote text stays flush at the margin. Use
            // a single replace WIDGET (not a mark): a mark fragments at the
            // marker↔text highlight boundary into separate spans, and two
            // `position:absolute; right:100%` spans would stack/overlap. One widget
            // = one box, so its own measured width sets the offset cleanly.
            const to = node.to + trailingWsLen(state, node.from, node.to);
            decos.push(hangLine.range(state.doc.lineAt(node.from).from));
            decos.push(
              Decoration.replace({
                widget: new HangMarkerWidget(state.doc.sliceString(node.from, to)),
              }).range(node.from, to),
            );
          } else {
            decos.push(syntaxMark.range(node.from, node.to));
          }
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
