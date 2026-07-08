import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Compartment, Facet, RangeSet, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";
import { EMOJI } from "./emoji-data";

/**
 * Emoji shortcodes (REQ-EMOJI-1): `:smile:` renders as the glyph in **Clean**
 * mode, while the literal `:smile:` stays on disk (portable GFM) and is revealed
 * back when the caret is on it — the same model as images.ts/tasks.ts (so it's
 * treated as content, never small-greyed in Syntax mode). Shortcodes are NOT a
 * Lezer node, so we scan the visible text with a regex and skip matches inside
 * code/URL constructs. Gated by the `emojiEnabled` facet (settings `markdown.emoji`).
 */

/** Live on/off for emoji rendering (settings `markdown.emoji`), via a compartment. */
export const emojiEnabled = Facet.define<boolean, boolean>({
  combine: (vals) => (vals.length ? vals[0] : true),
});
export const emojiCompartment = new Compartment();
export function setEmoji(view: EditorView, on: boolean) {
  view.dispatch({ effects: emojiCompartment.reconfigure(emojiEnabled.of(on)) });
}

class EmojiWidget extends WidgetType {
  constructor(
    readonly glyph: string,
    readonly code: string,
  ) {
    super();
  }
  eq(o: EmojiWidget) {
    return o.glyph === this.glyph && o.code === this.code;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-emoji";
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", `:${this.code}:`);
    s.textContent = this.glyph;
    return s;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

const hide = Decoration.replace({});
const SHORTCODE_RE = /:([a-z0-9_+-]+):/gi;

/** A shortcode inside code/URL/frontmatter is verbatim text, not an emoji. */
function inVerbatim(node: SyntaxNode): boolean {
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    switch (n.name) {
      case "InlineCode":
      case "FencedCode":
      case "CodeText":
      case "CodeBlock":
      case "URL":
      case "Autolink":
      case "Frontmatter":
      // Raw HTML is verbatim too (SPEC §5.2) — don't emojify `:code:` inside an
      // HTML tag/attribute/block/comment (GitHub doesn't either).
      case "HTMLBlock":
      case "HTMLTag":
      case "Comment":
      case "CommentBlock":
        return true;
    }
  }
  return false;
}

interface EmojiDecos {
  decorations: DecorationSet;
  hidden: RangeSet<Decoration>;
}

function buildEmojiDecos(view: EditorView): EmojiDecos {
  const { state } = view;
  if (state.facet(renderMode) !== "clean" || !state.facet(emojiEnabled)) {
    return { decorations: Decoration.none, hidden: RangeSet.empty };
  }
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];

  // Reveal-on-cursor: a caret touching a shortcode shows the literal text.
  const caretPos: number[] = [];
  for (const sel of state.selection.ranges) {
    caretPos.push(sel.from);
    if (sel.to !== sel.from) caretPos.push(sel.to);
  }

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    for (const m of text.matchAll(SHORTCODE_RE)) {
      const glyph = EMOJI[m[1].toLowerCase()];
      if (!glyph) continue; // unknown shortcode → leave literal
      const mFrom = from + (m.index ?? 0);
      const mTo = mFrom + m[0].length;
      if (caretPos.some((p) => p >= mFrom && p <= mTo)) continue; // reveal
      if (inVerbatim(syntaxTree(state).resolveInner(mFrom, 1))) continue; // code/url
      decos.push(
        Decoration.replace({ widget: new EmojiWidget(glyph, m[1].toLowerCase()) }).range(mFrom, mTo),
      );
      hidden.push(hide.range(mFrom, mTo));
    }
  }
  return { decorations: Decoration.set(decos, true), hidden: RangeSet.of(hidden, true) };
}

export const emojiDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hidden: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const r = buildEmojiDecos(view);
      this.decorations = r.decorations;
      this.hidden = r.hidden;
    }
    update(u: ViewUpdate) {
      const cleanNow = u.state.facet(renderMode) === "clean";
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.facet(renderMode) !== u.state.facet(renderMode) ||
        u.startState.facet(emojiEnabled) !== u.state.facet(emojiEnabled) ||
        (cleanNow && u.selectionSet) || // reveal-on-cursor rebuild
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        const r = buildEmojiDecos(u.view);
        this.decorations = r.decorations;
        this.hidden = r.hidden;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Make the Clean-mode emoji atomic: arrows skip it and one delete removes `:code:`. */
export const emojiAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(emojiDecorations)?.hidden ?? RangeSet.empty,
);
