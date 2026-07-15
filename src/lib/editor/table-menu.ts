import type { EditorView } from "@codemirror/view";
import {
  insertRow,
  deleteRow,
  insertCol,
  deleteCol,
  moveRow,
  moveCol,
  setColAlign,
  toggleHeader,
  type Align,
  type TableModel,
} from "./table-model";
import { replaceTable } from "./table-ops";

// The right-click context menu for a rendered table cell (Formatted mode, M5 S3b —
// REQ-TBLED-3/-5/-6). Every structural op for the clicked cell's row + column,
// applied as one whole-table replace; the caret stays OUTSIDE the block (we don't
// move it) so the rendered table updates in place — no flicker to raw pipes.

let openMenu: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

/** Close the open table context menu, if any (and drop its dismiss listeners). */
export function closeTableMenu(): void {
  cleanup?.();
  cleanup = null;
  openMenu?.remove();
  openMenu = null;
}

export function showTableMenu(
  view: EditorView,
  m: TableModel,
  row: number, // -1 = header/delimiter, 0+ = body row
  col: number,
  x: number,
  y: number,
): void {
  closeTableMenu();
  const isHeader = row < 0;

  const menu = document.createElement("div");
  menu.className = "cm-md-table-menu";
  menu.setAttribute("contenteditable", "false");

  // Each op runs through replaceTable: it commits an open inline cell editor and
  // re-parses the table from the live doc FIRST, so a mid-edit edit isn't lost and
  // the op never lands on stale offsets (adversarial-review fix). `m.from` (the table
  // start) is stable across a cell edit, so it's a safe re-resolve anchor.
  const run = (fn: (model: TableModel) => TableModel) => {
    replaceTable(view, m.from, fn);
    closeTableMenu();
    view.focus();
  };
  const item = (label: string, fn: ((model: TableModel) => TableModel) | null) => {
    const b = document.createElement("button");
    b.className = "cm-md-table-menu-item";
    b.textContent = label;
    if (fn) {
      b.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        run(fn);
      });
    } else {
      b.disabled = true;
    }
    menu.appendChild(b);
  };
  const sep = () => {
    const s = document.createElement("div");
    s.className = "cm-md-table-menu-sep";
    menu.appendChild(s);
  };
  const setA = (a: Align) => (md: TableModel) => setColAlign(md, col, a);

  // On a header cell (row = -1) there is no row "above" it (the header must stay
  // first), so disable that; "below" still means "add the first body row" → insert
  // at index 0. On a body row, above/below are the obvious row ± 1.
  item("Insert row above", isHeader ? null : (md) => insertRow(md, row));
  item("Insert row below", (md) => insertRow(md, row + 1)); // header: row+1 = 0
  item("Delete row", isHeader ? null : (md) => deleteRow(md, row));
  sep();
  item("Insert column left", (md) => insertCol(md, col));
  item("Insert column right", (md) => insertCol(md, col + 1));
  item("Delete column", (md) => deleteCol(md, col));
  sep();
  item("Move row up", isHeader ? null : (md) => moveRow(md, row, row - 1));
  item("Move row down", isHeader ? null : (md) => moveRow(md, row, row + 1));
  item("Move column left", (md) => moveCol(md, col, col - 1));
  item("Move column right", (md) => moveCol(md, col, col + 1));
  sep();
  item("Align left", setA("left"));
  item("Align center", setA("center"));
  item("Align right", setA("right"));
  item("Align clear", setA(null));
  sep();
  // Toggle the header row on/off (REQ-TBLED-2): a populated header demotes into the
  // first body row (blanked); a blank header promotes the first body row up.
  item("Toggle header row", (md) => toggleHeader(md));

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  // Append into the editor wrapper (not document.body) so the EditorView.theme
  // rules — scoped to descendants of `.cm-editor` — actually style it. It's
  // position:fixed, so it's placed against the viewport regardless of its parent.
  view.dom.appendChild(menu);
  openMenu = menu;

  // Keep the menu on-screen: a tall menu opened near the bottom/right edge would
  // otherwise be clipped — shift it back inside the viewport.
  /* v8 ignore start -- getBoundingClientRect needs real layout; happy-dom → 0-rects. */
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
  }
  if (rect.right > window.innerWidth) {
    menu.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
  }
  /* v8 ignore stop */

  // Dismiss on an outside click or Escape; listeners removed on close (no leak).
  const onDown = (e: MouseEvent) => {
    if (openMenu && !openMenu.contains(e.target as Node)) closeTableMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeTableMenu();
  };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey);
  cleanup = () => {
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey);
  };
}
