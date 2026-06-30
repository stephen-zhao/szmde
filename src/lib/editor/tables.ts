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
import { parseTable, tokenizeInline, type Align, type Cell, type TableModel } from "./table-model";
import { showTableMenu, closeTableMenu } from "./table-menu";

/**
 * Render a cell's inline markdown (bold / italic / strikethrough / inline code /
 * link) into `parent`, via the shared `tokenizeInline` (so the rendered DOM and the
 * click→source mapping never drift). Each segment is an element carrying
 * `data-seg-from` = its ABSOLUTE source offset (`baseOffset` + the segment's offset
 * within the cell), so a click on a rendered glyph maps to the exact source char —
 * including inside a formatted cell (REQ-TBLED-7, the M2 deferral). The editor's own
 * decoration pipeline can't be reused here (the widget is static DOM).
 */
export function renderInlineMarkdown(parent: HTMLElement, text: string, baseOffset = 0): void {
  for (const t of tokenizeInline(text)) {
    const name =
      t.kind === "strong"
        ? "strong"
        : t.kind === "del"
          ? "del"
          : t.kind === "code"
            ? "code"
            : t.kind === "link"
              ? "a"
              : t.kind === "em"
                ? "em"
                : "span";
    const el = document.createElement(name);
    el.textContent = t.text;
    el.dataset.segFrom = String(baseOffset + t.from);
    if (t.kind === "link") el.setAttribute("href", t.href!);
    parent.appendChild(el);
  }
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
 *
 * The cell map (text + source offsets + alignment) comes from the pure
 * `table-model.ts` (`parseTable`); this module is the CodeMirror adapter — locate
 * the `Table` block, render the model as a `<table>`, reveal source on caret-in.
 */

/* v8 ignore start -- caretPositionFromPoint/caretRangeFromPoint need real layout,
   which happy-dom doesn't provide; the plain-cell char mapping runs in the WebView. */
function caretOffsetIn(cell: HTMLElement, x: number, y: number): number | null {
  const doc = cell.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos && cell.contains(pos.offsetNode)) return pos.offset;
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range && cell.contains(range.startContainer)) return range.startOffset;
  return null;
}
/* v8 ignore stop */

/** Source position for a click on the table: the clicked inline SEGMENT's source
 *  start plus the in-segment character offset (segments carry `data-seg-from`, so it
 *  works inside formatted cells too — REQ-TBLED-7); else the clicked cell's start;
 *  else the table start (click not on a cell). */
function cellPosAt(e: MouseEvent, fallback: number): number {
  const target = e.target as HTMLElement | null;
  const seg = target?.closest?.("[data-seg-from]") as HTMLElement | null;
  if (seg) {
    const segFrom = Number(seg.dataset.segFrom);
    /* v8 ignore start -- caretPositionFromPoint is live-only; happy-dom returns null → +0. */
    const off = caretOffsetIn(seg, e.clientX, e.clientY);
    /* v8 ignore stop */
    return segFrom + (off ?? 0);
  }
  const cell = target?.closest?.("[data-cell-from]") as HTMLElement | null;
  return cell ? Number(cell.dataset.cellFrom) : fallback;
}

class TableWidget extends WidgetType {
  constructor(
    readonly m: TableModel, // full cell map + alignments; table start is m.from
    readonly key: string,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.key === this.key && o.m.from === this.m.from;
  }
  toDOM(view: EditorView) {
    const m = this.m;
    const table = document.createElement("table");
    table.className = "cm-md-table";
    table.setAttribute("contenteditable", "false");
    const align = (i: number): Align => m.aligns[i] ?? null;

    // `row` = -1 for a header cell, 0+ for a body row; carried as data-row/data-col
    // so the right-click menu knows which row + column the clicked cell belongs to.
    const fill = (el: HTMLTableCellElement, c: Cell, col: number, row: number) => {
      renderInlineMarkdown(el, c.text, c.from); // segments carry absolute data-seg-from
      el.dataset.cellFrom = String(c.from);
      el.dataset.row = String(row);
      el.dataset.col = String(col);
      if (align(col)) el.style.textAlign = align(col)!;
    };

    const hr = table.createTHead().insertRow();
    m.header.forEach((c, i) => {
      const th = document.createElement("th");
      fill(th, c, i, -1);
      hr.appendChild(th);
    });

    const tbody = table.createTBody();
    m.rows.forEach((row, r) => {
      const tr = tbody.insertRow();
      row.forEach((c, i) => fill(tr.insertCell(), c, i, r));
    });
    // Clicking a cell reveals the raw pipe source with the caret in that cell at
    // the clicked position. stopPropagation beats CM's own block-edge placement.
    table.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ selection: EditorSelection.cursor(cellPosAt(e, m.from)), scrollIntoView: true });
      view.focus();
    });
    // Right-click a cell → its structural-edit menu (insert/delete/move/align for
    // the cell's row + column — M5 S3, REQ-TBLED-3/-5/-6). The menu ops keep the
    // caret outside the block, so the rendered table updates in place.
    table.addEventListener("contextmenu", (e) => {
      const cell = (e.target as HTMLElement | null)?.closest?.("[data-row]") as HTMLElement | null;
      if (!cell) return;
      e.preventDefault();
      e.stopPropagation();
      showTableMenu(view, m, cell, e.clientX, e.clientY);
    });
    return table;
  }
  destroy() {
    closeTableMenu(); // table removed (re-render / scroll-away) → drop a stray menu
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
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

      // M5 S1: build the cell map from the pure table-model, which parses columns
      // from PIPE GEOMETRY — so an empty cell isn't dropped (the lezer grammar emits
      // no TableCell node for it, and the old getChildren("TableCell") indexing then
      // mis-assigned alignment + click targets for any table with a blank cell).
      // lezer is used only to locate the Table block [from, to].
      const m = parseTable(state.doc.sliceString(from, to), from);

      const key = JSON.stringify([m.header, m.rows, m.aligns]);
      decos.push(
        Decoration.replace({
          widget: new TableWidget(m, key),
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
