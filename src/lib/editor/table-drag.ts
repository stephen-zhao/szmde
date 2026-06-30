/**
 * Drag-to-reorder helpers for the Formatted-mode table (M5 S5, REQ-TBLED-4). The
 * gesture itself (pointer capture, gathering cell rects, drawing the drop indicator)
 * is layout-dependent and lives v8-ignored in the widget; the drop-target decision —
 * which item the pointer is over — is pure/here so it's unit-tested. The reorder is
 * applied via `table-ops.replaceTable` (commit-an-open-cell-editor-then-re-parse).
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
