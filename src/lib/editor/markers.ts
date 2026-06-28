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
// RENDER-9 (Syntax mode + Formatted reveal): a block marker (#…, >) + its
// trailing space hangs in the left margin so the heading/quote text stays flush.
// This is an in-flow `Decoration.mark` (NOT a replace widget): the marker glyphs
// remain real, editable text — the cursor glides into them with the arrow keys
// and they're mouse-selectable (a "syntax markers only" element must always stay
// in the document flow). theme.ts hangs it left with a width:0 inline-block that
// right-aligns its own glyphs (auto-measured overhang, baseline-aligned — no px
// constant, no absolute positioning that would float off the text baseline).
//
// KNOWN LIMIT: when a line has MULTIPLE leading block markers — a nested quote
// (`> > x`) or a quoted heading (`> # x`) — each marker hangs from ~the same
// width:0 origin, so the glyphs overlap in the gutter. This is the accepted
// trade-off of the in-flow approach (the alternative, a single replace widget,
// would break the "markers stay editable/selectable" requirement, B2/B6). Pure
// CSS can't both keep zero inline advance AND lay multiple visible glyphs side by
// side. Single markers (the overwhelmingly common case) render perfectly; the
// old absolute-positioned widget overlapped these same cases more severely.
const hangMark = Decoration.mark({ class: "cm-md-mark-syntax cm-md-mark-hang" });
// A list marker (bullet dash / ordered number) shown in Syntax mode. List markers
// are CONTENT (they render as •/1.), not pure syntax, so they keep normal text
// styling — never the small-grey syntax-token look (matches the task checkbox).
const listMarkerNormal = Decoration.mark({ class: "cm-md-list-marker" });

/** Length of the whitespace right after a block marker (the syntactic space after
 *  `#`/`>`), so the hidden (Clean) / hung (Syntax) range reaches the content. */
function trailingWsLen(state: EditorState, from: number, to: number): number {
  const line = state.doc.lineAt(from);
  return /^[ \t]+/.exec(line.text.slice(to - line.from))?.[0].length ?? 0;
}

/**
 * Emit the "syntax-token" styling for a managed marker, shared by Syntax mode and
 * Formatted-mode reveal-on-cursor (so a revealed marker looks/behaves exactly like
 * Syntax mode, never like a raw Source literal — RENDER #7):
 * - block marks (heading `#…` / quote `>`): an in-flow hung mark over the marker
 *   PLUS its trailing space, so the heading/quote text stays flush while the
 *   marker overhangs the left margin — yet remains editable/selectable text;
 * - inline marks (`**`, `*`, `~~`, `` ` ``): a small-grey syntax token in place.
 */
function pushSyntaxStyle(
  state: EditorState,
  decos: Range<Decoration>[],
  from: number,
  to: number,
  isBlockMark: boolean,
): void {
  if (isBlockMark) decos.push(hangMark.range(from, to + trailingWsLen(state, from, to)));
  else decos.push(syntaxMark.range(from, to));
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
          case "ListMark": {
            // A list marker is CONTENT, not pure syntax: it renders as a • / ordinal
            // in Formatted mode and, per the marker-vs-widget rule, shows its literal
            // in NORMAL text style (never small-grey) in Syntax mode.
            const ordered = parent?.parent?.name === "OrderedList";
            // A task item (`- [ ] ` or `1. [ ] `) renders a checkbox (tasks.ts) over
            // its whole prefix, so markers.ts must NOT also draw a bullet/number —
            // that would double-decorate the marker. Applies to BOTH list kinds.
            const isTask = node.node.parent?.getChild("Task") != null;
            if (mode === "clean") {
              if (isTask) {
                // defer entirely to tasks.ts (the checkbox)
              } else if (ordered) {
                // Replace `1.` with the computed ordinal (depth-styled, position-
                // based so nested lists restart). Edit the literal in Source/Syntax.
                decos.push(orderedNumberDeco(orderedMarkLabel(state, node.node)).range(node.from, node.to));
              } else {
                // Depth-varied glyph (•/◦/▪) so nesting reads clearly.
                decos.push(bulletDeco(bulletGlyph(node.node)).range(node.from, node.to));
              }
            } else if (mode === "markers-syntax") {
              decos.push(listMarkerNormal.range(node.from, node.to)); // #4 normal style
            }
            // Source mode: literal marker, default styling, no decoration.
            return;
          }
          default:
            rendered = undefined;
        }
        if (rendered === undefined) return;

        if (mode === "clean") {
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
          } else {
            // RENDER (#7): a revealed marker renders as a Syntax-style token — small
            // grey for inline marks, an in-flow hung marker for block marks — NOT a
            // raw Source literal. It stays editable (a mark, never atomic) and the
            // heading/quote text doesn't shift when the caret lands (the marker just
            // appears, hung in the margin).
            pushSyntaxStyle(state, decos, node.from, node.to, isBlockMark);
          }
        } else if (mode === "markers-syntax") {
          pushSyntaxStyle(state, decos, node.from, node.to, isBlockMark);
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

/**
 * Hang each block marker (`#…`/`>`) into the LEFT gutter (RENDER-9 / RENDER-10).
 * The marker is an in-flow inline-block (`.cm-md-mark-hang`); here we set its
 * `margin-left` to MINUS its own rendered width so it contributes zero inline
 * advance — the heading/quote text stays flush — while its glyphs overflow left
 * into the gutter. Doing it via the real measured width (not CSS) is what makes
 * it both flush AND baseline-aligned (inline-block sits on the text baseline) AND
 * free of the `>`-mirroring a `direction:rtl` trick would cause. Width is only
 * known after layout, so it runs in the measure phase.
 */
export const hangMarkerMargins = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.measure(view);
    }
    update(u: ViewUpdate) {
      const cleanNow = u.state.facet(renderMode) === "clean";
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.geometryChanged || // font-size zoom changes glyph widths
        u.startState.facet(renderMode) !== u.state.facet(renderMode) ||
        (cleanNow && u.selectionSet) || // reveal-on-cursor recreates the spans
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.measure(u.view);
      }
    }
    /* v8 ignore start -- requestMeasure read/write need real layout (offsetWidth);
       happy-dom reports 0 and never runs the measure cycle. Verified in the WebView
       (WF-24) and the live preview. */
    measure(view: EditorView) {
      view.requestMeasure({
        key: this,
        read: () =>
          Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-mark-hang")).map(
            (el) => [el, el.offsetWidth] as const,
          ),
        write: (pairs) => {
          for (const [el, w] of pairs) el.style.marginLeft = `-${w}px`;
        },
      });
    }
    /* v8 ignore stop */
  },
);
