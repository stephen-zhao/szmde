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

/** Header-cell variant that PRESERVES trailing padding — a header cell's trailing spaces
 *  are the overflow column width (REQ-TBLED-12), so they must stay editable in place.
 *  Leading whitespace is trimmed only when it precedes content; an all-whitespace cell
 *  (a deliberately-wide empty column) is kept as-is. */
export function sanitizeHeaderCell(s: string): string {
  const t = s
    .replace(/\r?\n/g, " ")
    .replace(/\\?\|/g, "\\|")
    .replace(/^\s+(?=\S)/, ""); // trim leading whitespace before content
  if (t === "") return "  "; // never collapse a header cell to zero width (fitted-empty)
  // Keep trailing padding as typed, but bottom out at the fitted single space — so a plain
  // content edit stays tidy (`| AA | …`) and deleting all padding lands at fitted, matching drag.
  return /\s$/.test(t) ? t : t + " ";
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
function focusEnd(ta: HTMLTextAreaElement, caret?: number): void {
  try {
    ta.focus();
    const p = caret ?? ta.value.length;
    ta.setSelectionRange(p, p);
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

  // Header cells edit the CONTENT **plus trailing padding** so the padding spaces (the
  // overflow column width, REQ-TBLED-12) are navigable + editable in place — physically
  // real, deletable characters. An all-whitespace cell's whole run is padding (splitRow
  // puts from===to at the closing pipe). Body cells stay content-only.
  const isHeader = row < 0;
  const trail = cell.raw.length - cell.raw.trimEnd().length;
  const editFrom = isHeader && cell.text === "" ? cell.to - cell.raw.length : cell.from;
  const editTo = isHeader ? (cell.text === "" ? cell.to : cell.to + trail) : cell.to;
  const sanitize = isHeader ? sanitizeHeaderCell : sanitizeCell;

  const src = view.state.sliceDoc(editFrom, editTo);
  const ta = document.createElement("textarea");
  ta.className = "cm-md-cell-editor";
  ta.value = src;
  ta.rows = 1;
  ta.spellcheck = false;
  cellEl.appendChild(ta);
  focusEnd(ta, isHeader ? cell.text.length : undefined); // land at the content end, before the padding

  const a: ActiveEditor = {
    ta,
    done: false,
    finish(commit, then) {
      if (a.done) return;
      a.done = true;
      if (active === a) active = null;
      ta.remove();
      if (commit) {
        const next = sanitize(ta.value);
        if (next !== src) view.dispatch({ changes: { from: editFrom, to: editTo, insert: next } });
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
    } else if (e.key === "Enter") {
      move("down"); // any Enter (incl. Shift) commits + moves down — cells are single-line
    } else if (e.key === "Tab") {
      move(e.shiftKey ? "prev" : "next");
    }
  });
  return true;
}
