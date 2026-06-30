import type { EditorView } from "@codemirror/view";
import { moveRow, moveCol, serialize, type TableModel } from "./table-model";

/**
 * Drag-to-reorder helpers for the Formatted-mode table (M5 S5, REQ-TBLED-4). The
 * gesture itself (pointer capture, gathering cell rects, drawing the drop indicator)
 * is layout-dependent and lives v8-ignored in the widget; the two decisions that
 * matter — which item the pointer is over, and applying the move — are pure/here so
 * they're unit-tested. The reorder is a whole-table replace with the caret left
 * outside, so the rendered table updates in place (consistent with the other ops).
 */

export type DragKind = "row" | "col";

/**
 * Index of the [start,end) span the `pointer` coordinate falls in (the drop target),
 * along the drag axis (Y for rows, X for columns). Before the first span → 0; past the
 * last → the last index. `spans` are in document order.
 */
export function indexAt(pointer: number, spans: { start: number; end: number }[]): number {
  if (!spans.length) return 0;
  for (let i = 0; i < spans.length; i++) {
    if (pointer < spans[i].end) return i;
  }
  return spans.length - 1;
}

/**
 * Apply a drag reorder: move row/column `from` → `to` as ONE whole-table replace.
 * No selection is set, so the caret stays outside the block and the table re-renders
 * in place. Returns false (no dispatch) when it's a no-op.
 */
export function applyMove(
  view: EditorView,
  m: TableModel,
  kind: DragKind,
  from: number,
  to: number,
): boolean {
  if (from === to) return false;
  const m2 = kind === "row" ? moveRow(m, from, to) : moveCol(m, from, to);
  if (m2 === m) return false; // out-of-range / identity
  view.dispatch({ changes: { from: m.from, to: m.to, insert: serialize(m2) } });
  return true;
}
