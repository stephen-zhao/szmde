import type { EditorView } from "@codemirror/view";
import { parseTable, type TableModel } from "./table-model";
import { tableBlockAt } from "./table-commands";

/**
 * Inline cell editor for Formatted-mode tables (REQ-TBLED-7, revised). Clicking a
 * cell opens a small editor OVER that cell — the table and every other cell stay
 * rendered (no more reveal-to-raw-pipes). The editor shows the cell's markdown SOURCE
 * (for a plain-text cell that's identical to the rendered text); committing replaces
 * just that cell's source span. Enter/Tab commit + move, Esc cancels.
 *
 * The editor is a <textarea> appended into the rendered <td>/<th>. Its value changes
 * are invisible to CodeMirror (a textarea's value isn't a DOM mutation), so CM's
 * document is untouched until commit — verified live: CM keeps the textarea, focus
 * sticks, and the doc stays intact while typing.
 */

interface ActiveEditor {
  ta: HTMLTextAreaElement;
  done: boolean;
  finish: (commit: boolean, then?: () => void) => void;
}

let active: ActiveEditor | null = null;

/** No raw newlines (they'd end the row) and escape bare pipes (they'd split cells). */
export function sanitizeCell(s: string): string {
  return s
    .replace(/\r?\n/g, " ")
    .replace(/\\?\|/g, "\\|")
    .trim();
}

/** Commit the open editor (write its content to the doc), if any. */
export function commitCellEditor(): void {
  active?.finish(true);
}

/** Discard the open editor without writing, if any. */
export function cancelCellEditor(): void {
  active?.finish(false);
}

/** True while a cell editor is open. */
export function isCellEditing(): boolean {
  return active != null;
}

const colsOf = (m: TableModel): number => Math.max(m.header.length, m.colCount);

/** The next/prev/below cell for Tab / Shift-Tab / Enter, or null at an edge. Cell
 *  order is the header row (row -1) then body rows 0..R-1, each left→right. */
export function step(
  m: TableModel,
  row: number,
  col: number,
  dir: "next" | "prev" | "down",
): { row: number; col: number } | null {
  const cols = colsOf(m);
  const R = m.rows.length;
  if (dir === "down") return row + 1 <= R - 1 ? { row: Math.max(0, row + 1), col } : null;
  if (dir === "next") {
    if (col + 1 < cols) return { row, col: col + 1 };
    const nr = row < 0 ? 0 : row + 1;
    return nr <= R - 1 ? { row: nr, col: 0 } : null;
  }
  if (col - 1 >= 0) return { row, col: col - 1 };
  if (row < 0) return null;
  return { row: row - 1, col: cols - 1 }; // row 0 → header (-1)
}

/* v8 ignore start -- focus + caret placement are no-ops in happy-dom (no real layout). */
function focusEnd(ta: HTMLTextAreaElement): void {
  try {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  } catch {
    /* best effort: happy-dom lacks real focus/selection */
  }
}
/* v8 ignore stop */

/**
 * Open the inline editor on cell (row, col) of the table at `tableFrom` (row -1 =
 * header). Re-resolves + re-parses from the live doc, so it's correct after a prior
 * commit shifted offsets. Returns false if there's no such rendered cell.
 */
export function editCellAt(view: EditorView, tableFrom: number, row: number, col: number): boolean {
  commitCellEditor(); // flush any open editor first (may shift the doc)
  const tbl = tableBlockAt(view.state, tableFrom);
  if (!tbl) return false;
  const m = parseTable(view.state.sliceDoc(tbl.from, tbl.to), tbl.from);
  const cells = row < 0 ? m.header : m.rows[row];
  if (!cells || col < 0 || col >= cells.length) return false;
  const cell = cells[col];
  const cellEl = view.contentDOM.querySelector<HTMLElement>(`[data-cell-from="${cell.from}"]`);
  if (!cellEl) return false;

  const src = view.state.sliceDoc(cell.from, cell.to);
  const ta = document.createElement("textarea");
  ta.className = "cm-md-cell-editor";
  ta.value = src;
  ta.rows = 1;
  ta.spellcheck = false;
  cellEl.appendChild(ta);
  focusEnd(ta);

  const a: ActiveEditor = {
    ta,
    done: false,
    finish(commit, then) {
      if (a.done) return;
      a.done = true;
      if (active === a) active = null;
      ta.remove();
      if (commit) {
        const next = sanitizeCell(ta.value);
        if (next !== src) view.dispatch({ changes: { from: cell.from, to: cell.to, insert: next } });
      }
      if (then) then();
      else view.focus();
    },
  };
  active = a;

  ta.addEventListener("mousedown", (e) => e.stopPropagation()); // not a cell click
  ta.addEventListener("blur", () => a.finish(true));
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep the CM keymap out of the cell editor
    const move = (dir: "next" | "prev" | "down") => {
      e.preventDefault();
      const at = step(m, row, col, dir);
      a.finish(true, () => {
        if (!at || !editCellAt(view, tableFrom, at.row, at.col)) view.focus();
      });
    };
    if (e.key === "Escape") {
      e.preventDefault();
      a.finish(false);
    } else if (e.key === "Enter" && !e.shiftKey) {
      move("down");
    } else if (e.key === "Tab") {
      move(e.shiftKey ? "prev" : "next");
    }
  });
  return true;
}
