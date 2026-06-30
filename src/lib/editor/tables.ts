import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import {
  RangeSet,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";
import {
  parseTable,
  serialize,
  insertRow,
  insertCol,
  tokenizeInline,
  type Align,
  type Cell,
  type TableModel,
} from "./table-model";
import { showTableMenu, closeTableMenu } from "./table-menu";
import { indexAt, applyMove, type DragKind } from "./table-drag";
import { editCellAt, commitCellEditor } from "./table-cell-editor";

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
 * GFM tables (SPEC §5.1). Clean (Formatted) mode replaces the pipe-table source with
 * a real `<table>` block widget. The table STAYS rendered while you edit — clicking a
 * cell opens an inline editor over just that cell (`table-cell-editor.ts`); the table
 * never flips to raw pipes here (use Source mode for that). Structural editing — the
 * right-click menu, hover gizmos, and drag handles — operates on the source via
 * whole-table replaces, so the rendered table updates in place.
 *
 * Block-level / cross-line replacing decorations cannot be supplied from a
 * ViewPlugin (the editor needs them before computing vertical layout), so unlike
 * the other M2 constructs this is built from a **StateField** and provided via
 * `EditorView.decorations.from`.
 *
 * The cell map (text + source offsets + alignment) comes from the pure
 * `table-model.ts` (`parseTable`); this module is the CodeMirror adapter — locate
 * the `Table` block and render the model as a `<table>`.
 */

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

    // A hover "+" affordance that inserts a row/column at a table edge (M5 S3b). Like
    // the menu ops it's a whole-table replace with the caret left OUTSIDE, so the
    // rendered table updates in place. The "+" glyph is a CSS ::before (not DOM text)
    // so it never leaks into a cell's textContent. tabindex -1: it's a hover-only
    // mouse affordance — the keyboard paths are the keymap + the right-click menu.
    const addGizmo = (cell: HTMLElement, cls: string, title: string, op: () => TableModel) => {
      const g = document.createElement("button");
      g.className = `cm-tbl-gizmo ${cls}`;
      g.type = "button";
      g.tabIndex = -1;
      g.title = title;
      g.setAttribute("aria-label", title);
      g.addEventListener("mousedown", (e) => {
        // Primary button only — a right/middle-click must fall through (don't insert,
        // don't stopPropagation) so it reaches the contextmenu handler for the menu.
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation(); // beat the table's reveal-on-mousedown
        view.dispatch({ changes: { from: m.from, to: m.to, insert: serialize(op()) } });
        view.focus();
      });
      cell.appendChild(g);
    };

    // A drag grip to reorder a row/column (M5 S5, REQ-TBLED-4). Shown on hover; on a
    // primary-button drag it pointer-captures, hit-tests the row/column under the
    // pointer (highlighting the drop target), and on release moves source → target as
    // a whole-table replace (caret left outside → in-place update). The drop math
    // (`indexAt`) and the move (`applyMove`) are pure + unit-tested; the gesture
    // (pointer capture + getBoundingClientRect) is layout-only, hence v8-ignored.
    const addDragGrip = (cell: HTMLElement, kind: DragKind, index: number) => {
      const g = document.createElement("span");
      g.className = `cm-tbl-drag cm-tbl-drag-${kind}`;
      g.title = kind === "row" ? "Drag to reorder row" : "Drag to reorder column";
      g.setAttribute("aria-hidden", "true");
      // A real pointer drag ALSO fires a compatibility mousedown on the grip; swallow
      // it so it can't bubble to the table's reveal-on-mousedown handler and abort the
      // drag (a synthetic PointerEvent doesn't emit this, so it's invisible to tests
      // that only dispatch pointer events — hence the dedicated mousedown test).
      g.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      g.addEventListener("pointerdown", (e) => {
        /* v8 ignore start -- pointer DnD gesture: needs real layout + pointer capture
           (happy-dom has neither); the drop index + the move are unit-tested separately. */
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          g.setPointerCapture(e.pointerId); // route move/up here even off the grip
        } catch {
          /* no active pointer (e.g. synthetic event) — the drag still tracks */
        }
        let target = index;
        const clearDrop = () =>
          table.querySelectorAll(".cm-tbl-drop").forEach((el) => el.classList.remove("cm-tbl-drop"));
        const spansNow = () =>
          kind === "row"
            ? [...table.tBodies[0].rows].map((r) => {
                const b = r.getBoundingClientRect();
                return { start: b.top, end: b.bottom };
              })
            : [...(table.tHead?.rows[0].cells ?? [])].map((c) => {
                const b = c.getBoundingClientRect();
                return { start: b.left, end: b.right };
              });
        const dropEl = (i: number): HTMLElement | undefined =>
          kind === "row" ? table.tBodies[0].rows[i] : table.tHead?.rows[0].cells[i];
        const onMove = (ev: PointerEvent) => {
          target = indexAt(kind === "row" ? ev.clientY : ev.clientX, spansNow());
          clearDrop();
          dropEl(target)?.classList.add("cm-tbl-drop");
        };
        const onUp = () => {
          g.removeEventListener("pointermove", onMove);
          g.removeEventListener("pointerup", onUp);
          clearDrop();
          applyMove(view, m, kind, index, target);
          view.focus();
        };
        g.addEventListener("pointermove", onMove);
        g.addEventListener("pointerup", onUp);
        /* v8 ignore stop */
      });
      cell.appendChild(g);
    };

    // `row` = -1 for a header cell, 0+ for a body row; carried as data-row/data-col
    // so the right-click menu knows which row + column the clicked cell belongs to.
    const fill = (el: HTMLTableCellElement, c: Cell, col: number, row: number) => {
      renderInlineMarkdown(el, c.text, c.from); // segments carry absolute data-seg-from
      el.dataset.cellFrom = String(c.from);
      el.dataset.row = String(row);
      el.dataset.col = String(col);
      if (align(col)) el.style.textAlign = align(col)!;
      // Header strip → column-insert handles (right edge of each; the first cell also
      // gets a leading-column handle on its left edge). Left gutter (col 0) → a
      // row-insert handle on each cell's bottom edge (the header's adds body row 0).
      if (row === -1) {
        addGizmo(el, "cm-tbl-gizmo-col", "Insert column right", () => insertCol(m, col + 1));
        if (col === 0) addGizmo(el, "cm-tbl-gizmo-colstart", "Insert column left", () => insertCol(m, 0));
        addDragGrip(el, "col", col); // drag the header cell to reorder its column
      }
      if (col === 0) {
        addGizmo(el, "cm-tbl-gizmo-row", "Insert row below", () => insertRow(m, row + 1));
        if (row >= 0) addDragGrip(el, "row", row); // drag a body row's first cell to reorder it
      }
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
    // Left-clicking a cell opens the inline editor over it — the table stays rendered
    // (REQ-TBLED-7). A right/middle-click falls through (return) to the contextmenu
    // handler for the structural menu. stopPropagation keeps CM from placing a caret.
    table.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0) return;
      const cell = (e.target as HTMLElement | null)?.closest?.("[data-row]") as HTMLElement | null;
      if (cell) editCellAt(view, m.from, Number(cell.dataset.row), Number(cell.dataset.col));
    });
    // Right-click a cell → its structural-edit menu (insert/delete/move/align for
    // the cell's row + column — M5 S3b, REQ-TBLED-3/-5/-6). The menu ops keep the
    // caret outside the block, so the rendered table updates in place.
    table.addEventListener("contextmenu", (e) => {
      const cell = (e.target as HTMLElement | null)?.closest?.("[data-row]") as HTMLElement | null;
      if (!cell) return;
      e.preventDefault();
      e.stopPropagation();
      showTableMenu(view, m, Number(cell.dataset.row), Number(cell.dataset.col), e.clientX, e.clientY);
    });
    return table;
  }
  destroy() {
    closeTableMenu(); // table removed (re-render / scroll-away) → drop a stray menu
    commitCellEditor(); // …and flush an open inline cell editor (keep the edit)
  }
  /* v8 ignore start -- event plumbing; widget events aren't dispatched in happy-dom. */
  ignoreEvent(e: Event) {
    // Let CM see WHEEL events so scroll-zoom still works over the table — otherwise
    // shift+scroll can't change the page width and ctrl/cmd+scroll can't zoom the font
    // (REQ-ZOOM-1/2). The widget handles its own pointer events (cell clicks, gizmos,
    // drag grips, the context menu) and those stay ignored by the editor.
    return e.type !== "wheel";
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

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return undefined;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      // The table ALWAYS stays rendered in Clean mode now (no reveal-to-source);
      // cells are edited in place via the inline editor (table-cell-editor.ts).

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
    // No `tr.selection` trigger: the table no longer reveals on caret-in, so the
    // decorations depend only on the doc / render mode / parse tree, not the cursor.
    if (
      tr.docChanged ||
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
