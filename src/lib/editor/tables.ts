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
 * Render a cell's inline markdown (bold / italic / strikethrough / inline code /
 * link) into `parent`. A small, non-nested tokenizer — the table widget can't
 * reuse the editor's decoration pipeline (it's static DOM), and full CommonMark
 * inline parsing would be overkill here. Unknown / nested-inside-nested markup
 * falls back to literal text.
 */
const INLINE_RE =
  /\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\)/;
export function renderInlineMarkdown(parent: HTMLElement, text: string): void {
  let rest = text;
  for (let m = INLINE_RE.exec(rest); m; m = INLINE_RE.exec(rest)) {
    if (m.index > 0) parent.appendChild(document.createTextNode(rest.slice(0, m.index)));
    if (m[1] !== undefined) parent.appendChild(tag("strong", m[1]));
    else if (m[2] !== undefined) parent.appendChild(tag("del", m[2]));
    else if (m[3] !== undefined) parent.appendChild(tag("code", m[3]));
    else if (m[4] !== undefined) parent.appendChild(tag("em", m[4]));
    else if (m[5] !== undefined) parent.appendChild(tag("em", m[5]));
    else {
      const a = tag("a", m[6]) as HTMLAnchorElement;
      a.setAttribute("href", m[7]);
      parent.appendChild(a);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) parent.appendChild(document.createTextNode(rest));
}
function tag(name: string, text: string): HTMLElement {
  const el = document.createElement(name);
  el.textContent = text;
  return el;
}

/**
 * GFM tables (SPEC §5.1) — **render-only** in M2. Clean mode replaces the
 * pipe-table source with a real `<table>` (a block widget); the caret entering
 * the table reveals the raw source so it stays editable. The rich structured
 * editing experience (insert/reorder rows & columns, drag handles, cursor-context
 * shortcuts) is the separate, deferred §7.4 effort.
 *
 * Block-level / cross-line replacing decorations cannot be supplied from a
 * ViewPlugin (the editor needs them before computing vertical layout), so unlike
 * the other M2 constructs this is built from a **StateField** and provided via
 * `EditorView.decorations.from`.
 */
type Align = "left" | "center" | "right" | null;

class TableWidget extends WidgetType {
  constructor(
    readonly headers: string[],
    readonly rows: string[][],
    readonly aligns: Align[],
    readonly from: number, // table start — where to drop the caret on click
    readonly key: string,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.key === this.key && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const table = document.createElement("table");
    table.className = "cm-md-table";
    table.setAttribute("contenteditable", "false");
    const align = (i: number): Align => this.aligns[i] ?? null;

    const thead = table.createTHead();
    const hr = thead.insertRow();
    this.headers.forEach((h, i) => {
      const th = document.createElement("th");
      renderInlineMarkdown(th, h);
      if (align(i)) th.style.textAlign = align(i)!;
      hr.appendChild(th);
    });

    const tbody = table.createTBody();
    for (const row of this.rows) {
      const tr = tbody.insertRow();
      row.forEach((cell, i) => {
        const td = tr.insertCell();
        renderInlineMarkdown(td, cell);
        if (align(i)) td.style.textAlign = align(i)!;
      });
    }
    // Clicking the rendered table reveals the raw pipe source for editing (until
    // the rich structured table-editing experience lands — SPEC §7.4).
    table.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.from), scrollIntoView: true });
      view.focus();
    });
    return table;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

const cellText = (state: EditorState, from: number, to: number) =>
  state.doc.sliceString(from, to).trim();

/** Parse per-column alignment from a separator row like `| :-- | :-: | --: |`. */
function parseAligns(sep: string): Align[] {
  const inner = sep.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((s) => {
    const t = s.trim();
    const l = t.startsWith(":");
    const r = t.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : null;
  });
}

interface TableDecos {
  deco: DecorationSet;
  hidden: RangeSet<Decoration>;
}

const EMPTY: TableDecos = { deco: Decoration.none, hidden: RangeSet.empty };

function computeTableDecos(state: EditorState): TableDecos {
  if (state.facet(renderMode) !== "clean") return EMPTY;
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const sel = state.selection.ranges;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return undefined;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      // Reveal-to-source when the caret/selection touches the table.
      if (sel.some((r) => r.to >= from && r.from <= to)) return false;

      const tn = node.node;
      const header = tn.getChild("TableHeader");
      const headers = header
        ? header.getChildren("TableCell").map((c) => cellText(state, c.from, c.to))
        : [];
      const sepNode = tn.getChildren("TableDelimiter")[0];
      const aligns = sepNode ? parseAligns(state.doc.sliceString(sepNode.from, sepNode.to)) : [];
      const rows = tn
        .getChildren("TableRow")
        .map((r) => r.getChildren("TableCell").map((c) => cellText(state, c.from, c.to)));

      const key = JSON.stringify([headers, rows, aligns]);
      decos.push(
        Decoration.replace({
          widget: new TableWidget(headers, rows, aligns, from, key),
          block: true,
        }).range(from, to),
      );
      hidden.push(Decoration.replace({}).range(from, to));
      return false; // already extracted; don't descend into the table internals
    },
  });

  return { deco: Decoration.set(decos, true), hidden: RangeSet.of(hidden, true) };
}

const tableField = StateField.define<TableDecos>({
  create: computeTableDecos,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.startState.facet(renderMode) !== tr.state.facet(renderMode) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return computeTableDecos(tr.state);
    }
    return value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).hidden),
  ],
});

export const tableExtension: Extension = tableField;
