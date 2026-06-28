import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Prec, RangeSetBuilder } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  codeFolding,
  foldKeymap,
  foldable,
  foldedRanges,
  syntaxTree,
  toggleFold,
} from "@codemirror/language";

/**
 * Collapsible heading sections (REQ-FOLD-1, SPEC §5.4). lang-markdown already
 * supplies the heading-section foldService (fold from the heading-line end through
 * the next same-or-higher heading, syntax-tree based so `#` inside fenced code
 * isn't a heading); this module adds the AFFORDANCES + the fold state machine:
 *
 * - `codeFolding` with a `⋯` placeholder (click to unfold),
 * - an inline chevron on each foldable heading line (▾/▸, click to toggle — no
 *   gutter, so the centered reading column is preserved),
 * - the standard fold keymap + `Mod-.` toggle.
 *
 * Headings only in v1 (fenced code / lists are a later addition).
 */

// --- Inline chevron affordance on foldable heading lines -------------------
class FoldChevron extends WidgetType {
  constructor(
    readonly line: number,
    readonly folded: boolean,
  ) {
    super();
  }
  eq(o: FoldChevron) {
    return o.line === this.line && o.folded === this.folded;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-fold-chevron";
    el.textContent = this.folded ? "▸" : "▾";
    el.setAttribute("title", this.folded ? "Unfold section" : "Fold section");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", this.folded ? "Unfold section" : "Fold section");
    el.setAttribute("aria-expanded", this.folded ? "false" : "true");
    el.setAttribute("contenteditable", "false");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ selection: { anchor: view.state.doc.line(this.line).from } });
      toggleFold(view);
    });
    return el;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

function isFolded(state: EditorState, lineEnd: number): boolean {
  let folded = false;
  foldedRanges(state).between(lineEnd, lineEnd, () => {
    folded = true;
  });
  return folded;
}

const HEADING_NODE = /^(ATXHeading[1-6]|SetextHeading[12])$/;

/** A heading line gets a chevron. lang-markdown makes EVERY line in a section
 *  foldable (fold-from-cursor), so we restrict the affordance to heading lines. */
function isHeadingLine(state: EditorState, lineFrom: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(lineFrom, 1); n; n = n.parent) {
    if (HEADING_NODE.test(n.name)) return true;
  }
  return false;
}

function buildChevrons(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (isHeadingLine(state, line.from) && foldable(state, line.from, line.to)) {
        builder.add(
          line.from,
          line.from,
          Decoration.widget({ widget: new FoldChevron(line.number, isFolded(state, line.to)), side: -1 }),
        );
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const foldChevrons = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildChevrons(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        // foldState is replaced by reference on ANY change — incl. CM's
        // clearTouchedFolds, which silently unfolds when a selection (e.g. a Find
        // match) lands in a folded body WITHOUT a fold effect. This keeps the
        // chevron glyph in sync; it subsumes the foldEffect/unfoldEffect check.
        foldedRanges(u.startState) !== foldedRanges(u.state)
      ) {
        this.decorations = buildChevrons(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const folding = codeFolding({
  placeholderDOM(_view, onclick) {
    const el = document.createElement("span");
    el.className = "cm-foldPlaceholder";
    el.textContent = "⋯";
    el.setAttribute("title", "Click to unfold");
    el.setAttribute("aria-label", "folded section");
    el.onclick = onclick;
    return el;
  },
});

export const foldExtension: Extension = [
  folding,
  foldChevrons,
  Prec.high(keymap.of([...foldKeymap, { key: "Mod-.", run: toggleFold }])),
];
