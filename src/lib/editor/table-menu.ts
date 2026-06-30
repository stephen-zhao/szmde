import type { EditorView } from "@codemirror/view";
import {
  serialize,
  insertRow,
  deleteRow,
  insertCol,
  deleteCol,
  moveRow,
  moveCol,
  setColAlign,
  type Align,
  type TableModel,
} from "./table-model";

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
  cell: HTMLElement,
  x: number,
  y: number,
): void {
  closeTableMenu();
  const row = Number(cell.dataset.row); // -1 = header, 0+ = body row
  const col = Number(cell.dataset.col);
  const isHeader = row < 0;

  const menu = document.createElement("div");
  menu.className = "cm-md-table-menu";
  menu.setAttribute("contenteditable", "false");

  const apply = (m2: TableModel) => {
    if (m2 !== m) view.dispatch({ changes: { from: m.from, to: m.to, insert: serialize(m2) } });
    closeTableMenu();
    view.focus();
  };
  const item = (label: string, fn: (() => TableModel) | null) => {
    const b = document.createElement("button");
    b.className = "cm-md-table-menu-item";
    b.textContent = label;
    if (fn) {
      b.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        apply(fn());
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
  const setA = (a: Align) => () => setColAlign(m, col, a);

  // On a header cell (row = -1) there is no row "above" it (the header must stay
  // first), so disable that; "below" still means "add the first body row" → insert
  // at index 0. On a body row, above/below are the obvious row ± 1.
  item("Insert row above", isHeader ? null : () => insertRow(m, row));
  item("Insert row below", () => insertRow(m, row + 1)); // header: row+1 = 0
  item("Delete row", isHeader ? null : () => deleteRow(m, row));
  sep();
  item("Insert column left", () => insertCol(m, col));
  item("Insert column right", () => insertCol(m, col + 1));
  item("Delete column", () => deleteCol(m, col));
  sep();
  item("Move row up", isHeader ? null : () => moveRow(m, row, row - 1));
  item("Move row down", isHeader ? null : () => moveRow(m, row, row + 1));
  item("Move column left", () => moveCol(m, col, col - 1));
  item("Move column right", () => moveCol(m, col, col + 1));
  sep();
  item("Align left", setA("left"));
  item("Align center", setA("center"));
  item("Align right", setA("right"));
  item("Align clear", setA(null));

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
