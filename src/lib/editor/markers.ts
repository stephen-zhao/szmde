import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSet, StateEffect, type EditorState, type Range } from "@codemirror/state";
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
// Clean mode, block marker OFF the caret line: the SAME gutter-hung prefix as the
// grey revealed marker, but painted transparent. The marker keeps its slot in the
// reserved gutter column, so revealing it (→ grey) only changes COLOUR — the
// heading/quote content never reflows, killing the sub-pixel jitter that came from
// adding the marker + text-indent on reveal vs removing them when hidden. Shares
// cm-md-mark-syntax sizing so the transparent and grey prefixes are pixel-identical.
const invisibleMark = Decoration.mark({ class: "cm-md-mark-syntax cm-md-mark-invisible" });

// RENDER-9/10/12 (Syntax mode + Formatted reveal): a block marker (#…, >) + its
// trailing space hangs in the LEFT "marker gutter" column so the heading/quote text
// stays flush with body text — while staying real, editable, selectable text (a
// mark, never a replace widget) so the caret glides through it (B2/B6).
//
// MECHANISM: a per-LINE `text-indent: -<prefix width>` (NOT a per-marker negative
// margin). This is the crux of the WebView2 caret fix: a negative margin moves the
// marker GLYPH but not the line's inline content ORIGIN, so the native caret for
// "before #" rendered at the margin, not the gutter — engine-dependent (correct in
// some Chromium builds, wrong in WebView2; CM's own RectangleMarker cursor got it
// wrong too). `text-indent` moves the inline origin itself, so the caret follows
// the glyph into the gutter in EVERY engine. The indent equals the rendered width
// of the whole leading marker prefix (`#…`/`>`(s) + spaces), measured with a canvas
// at the marker font; the prefix is small-greyed so its measured width matches what
// renders. Both are baked into DECORATIONS (an inline `style` on a line deco + a
// mark), so CM re-applies them on every render — never a post-layout plugin, which
// CM would drop on each line re-render, flicking the marker/caret between gutter and
// margin (the old "cursor in the wrong place" bug). Re-measured on font load / size
// change (see `remeasureOnFontChange`).
const lineIndentCache = new Map<number, Decoration>();
/** A line decoration that pulls its first line left by `widthPx` (the measured
 *  width of the line's leading marker prefix) via `text-indent`, hanging the
 *  markers in the gutter while the content stays flush — the caret included. */
function lineIndent(widthPx: number): Decoration {
  let d = lineIndentCache.get(widthPx);
  if (!d) {
    lineIndentCache.set(
      widthPx,
      (d = Decoration.line({ attributes: { style: `text-indent:-${widthPx}px` } })),
    );
  }
  return d;
}

// Canvas text measurement (cached by font+text). Used to size the hang offset at
// decoration-build time — synchronous, no DOM layout, no reflow.
let measureCanvas: HTMLCanvasElement | undefined;
const widthCache = new Map<string, number>();
function measureTextWidth(text: string, font: string): number {
  const key = font + " " + text;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  /* v8 ignore start -- the 2d-canvas measurement is browser-only (happy-dom has no
     2d context, so DOM tests take the `!ctx → 0` fallback = no hang); verified live
     and by the WF-24 layout assertions. */
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  widthCache.set(key, w);
  return w;
  /* v8 ignore stop */
}

/** The CSS `font` shorthand for the small-grey marker (0.75 × the editor font), so
 *  the canvas measures the marker glyphs at the size they actually render. */
function markerFont(view: EditorView): string {
  const cs = getComputedStyle(view.contentDOM);
  const size = (parseFloat(cs.fontSize) || 16) * 0.75;
  return `${size}px ${cs.fontFamily || "sans-serif"}`;
}

// A list marker (bullet dash / ordered number) shown in Syntax mode. List markers
// are CONTENT (they render as •/1.), not pure syntax, so they keep normal text
// styling — never the small-grey syntax-token look (matches the task checkbox).
const listMarkerNormal = Decoration.mark({ class: "cm-md-list-marker" });

/** The leading block-marker prefix on a line, up to the first content char — its
 *  rendered width is the `text-indent` that hangs the markers in the gutter.
 *  Mirrors lezer's block-marker boundaries: an optional CommonMark indent (≤3
 *  spaces — 4+ is a code block, never a block marker, so lezer never calls us
 *  there), the blockquote `>` nesting, then an optional ATX `#…` run that REQUIRES
 *  a following space or EOL. The trailing-space requirement is what keeps a content
 *  `#` out of the prefix — the 2nd `#` in `# # x`, or `> #tag` — which a naive
 *  `[>#]+` would wrongly grey + over-indent. Leading whitespace is included so an
 *  indented `   # h` / `  > q` still hangs (the old `^`-anchored regex missed it). */
const BLOCK_PREFIX = /^[ \t]*(?:>[ \t]*)*(?:#{1,6}(?:[ \t]+|$))?/;

/**
 * Render a SHOWN block-marker line (Syntax mode, or Formatted-mode reveal-on-cursor)
 * as a gutter-hung prefix — done ONCE per line, even when the line carries several
 * block markers (nested `> >`, a quoted heading `> #`): the whole leading prefix is
 * small-greyed and the line is `text-indent`-ed by the prefix's measured width, so
 * every marker hangs in the gutter, the content stays flush, and the caret glides
 * through (see the lineIndent note above).
 */
function handleShownBlockLine(
  state: EditorState,
  decos: Range<Decoration>[],
  lineFrom: number,
  lineNumber: number,
  handled: Set<number>,
  font: string,
  mark: Decoration, // syntaxMark (grey) or invisibleMark (transparent, Clean off-line)
): void {
  if (handled.has(lineNumber)) return;
  handled.add(lineNumber);
  const text = state.doc.line(lineNumber).text;
  // BLOCK_PREFIX always matches (all parts optional), but for a real leading block
  // marker the prefix is non-empty; bail on the (defensive, unreachable) empty case.
  const prefixLen = BLOCK_PREFIX.exec(text)?.[0].length ?? 0;
  if (prefixLen === 0) return;
  decos.push(mark.range(lineFrom, lineFrom + prefixLen)); // markers + spaces (grey or transparent)
  // text-indent = the prefix's rendered width (0 in happy-dom — no canvas 2d — so the
  // pixel shift is verified live; the deco is still emitted so its presence is tested).
  const w = Math.round(measureTextWidth(text.slice(0, prefixLen), font));
  decos.push(lineIndent(w).range(lineFrom));
}

/**
 * Emit GREY "syntax-token" styling for a SHOWN managed marker — Syntax mode, and
 * Clean-mode inline reveal-on-cursor (so a revealed marker looks like Syntax mode,
 * never a raw Source literal — RENDER #7):
 * - block marks (heading `#…` / quote `>`): a per-line gutter hang (text-indent +
 *   grey prefix), keeping the marker editable/selectable text;
 * - inline marks (`**`, `*`, `~~`, `` ` ``): a grey syntax token in place.
 * (Clean mode renders block markers via handleShownBlockLine directly, choosing grey
 * vs transparent per the caret line — see the mode branch below.)
 */
function pushShownMark(
  state: EditorState,
  decos: Range<Decoration>[],
  from: number,
  to: number,
  isBlockMark: boolean,
  handled: Set<number>,
  font: string,
): void {
  if (isBlockMark) {
    const line = state.doc.lineAt(from);
    handleShownBlockLine(state, decos, line.from, line.number, handled, font, syntaxMark);
  } else {
    decos.push(syntaxMark.range(from, to));
  }
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
  // The marker font (for measuring the gutter overhang width) only matters when a
  // block marker is actually hung — i.e. not in Source mode. Compute it lazily so
  // a getComputedStyle read happens at most once per build, and never in Source.
  let font: string | null = null;
  const getFont = () => (font ??= markerFont(view));
  // A line may carry several block markers (nested `> >`, a quoted heading `> #`);
  // its gutter hang (text-indent + prefix mark) is emitted only once.
  const handledBlockLines = new Set<number>();

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
          if (isBlockMark) {
            // Block markers (heading `#…` / quote `>`) ALWAYS hang in the gutter
            // (text-indent) in flow; revealing only flips colour grey↔transparent, so
            // the heading/quote content NEVER reflows when the caret lands on the line
            // — killing the sub-pixel jitter of add-marker+indent vs remove. They sit
            // in the reserved gutter column, so an off-cursor transparent marker is
            // invisible at zero layout cost. In flow ⇒ NOT atomic in Clean mode: the
            // caret glides through them exactly as in Syntax mode (the cursor-glide
            // contract), instead of skipping a removed marker.
            const line = state.doc.lineAt(node.from);
            const revealed = caretLines.has(line.number);
            handleShownBlockLine(
              state, decos, line.from, line.number, handledBlockLines, getFont(),
              revealed ? syntaxMark : invisibleMark,
            );
          } else {
            // Inline markers are IN the text, so reserving their slot would leave
            // visible gaps — keep them hidden (removed, atomic) off-cursor and shown
            // (grey, RENDER #7) when a caret is within their construct.
            const revealed = caretPos.some(
              (p) => p >= (parent ? parent.from : node.from) && p <= (parent ? parent.to : node.to),
            );
            if (!revealed) {
              decos.push(hide.range(node.from, node.to));
              hiddenRanges.push(hide.range(node.from, node.to));
            } else {
              decos.push(syntaxMark.range(node.from, node.to));
            }
          }
        } else if (mode === "markers-syntax") {
          pushShownMark(state, decos, node.from, node.to, isBlockMark, handledBlockLines, getFont());
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

/** Dispatched when the editor font (size / family / async web-font load) changes,
 *  so the cached marker-prefix widths are recomputed and the gutter realigns. */
export const remeasureMarkers = StateEffect.define<null>();

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
        u.transactions.some((tr) => tr.effects.some((e) => e.is(remeasureMarkers))) ||
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

/**
 * Keep the gutter hang aligned when the editor font changes. The text-indent that
 * hangs block markers is a px width measured at the marker font, so it must be
 * recomputed when that font changes — but a font change arrives as a CSS-variable
 * write on documentElement (settings) or an async web-font load, NEITHER of which
 * produces a CM transaction. This watcher bridges that gap: it clears the width
 * cache and dispatches `remeasureMarkers` so the decorations rebuild at the new
 * metrics. Addresses the "what if the font family is customizable?" robustness
 * concern — the measurement adapts to whatever font actually renders.
 */
export const remeasureOnFontChange = ViewPlugin.fromClass(
  class {
    /* v8 ignore start -- DOM font plumbing (MutationObserver / document.fonts /
       getComputedStyle); happy-dom has no fonts API or real layout, and the
       rebuild path is covered by the docChanged branch above. */
    obs: MutationObserver | undefined;
    destroyed = false;
    constructor(view: EditorView) {
      let lastFont = markerFont(view);
      const rebuild = () => {
        // The plugin is recreated on every setState (document open); guard against a
        // late fonts.ready callback dispatching into a destroyed view.
        if (this.destroyed) return;
        widthCache.clear();
        view.dispatch({ effects: remeasureMarkers.of(null) });
      };
      // Web font STILL loading: the family string won't change but the glyph metrics
      // will, so rebuild once when it resolves. If fonts are already loaded (the
      // common case on later document opens), the build measured correctly — skip the
      // redundant rebuild rather than firing one per file open.
      if (document.fonts && document.fonts.status !== "loaded") {
        document.fonts.ready.then(rebuild).catch(() => {});
      }
      // Font size / family settings write to CSS vars on documentElement; only
      // rebuild when the resolved marker font actually changed (ignore unrelated
      // var writes like accent color or reading width on every Shift-scroll tick).
      this.obs = new MutationObserver(() => {
        const f = markerFont(view);
        if (f === lastFont) return;
        lastFont = f;
        rebuild();
      });
      this.obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    }
    destroy() {
      this.destroyed = true;
      this.obs?.disconnect();
    }
    /* v8 ignore stop */
  },
);

/** Make Formatted-mode hidden markers atomic: arrow keys skip over them and a
 *  single Backspace/Delete removes the whole marker rather than landing in the
 *  zero-width gap left by the replace decoration. */
export const markerAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(markerDecorations)?.hidden ?? RangeSet.empty,
);
