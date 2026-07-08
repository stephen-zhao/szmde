import type { EditorView } from "@codemirror/view";
import { parseTable, serialize, type TableModel } from "./table-model";
import { tableBlockAt } from "./table-commands";
import { commitCellEditor } from "./table-cell-editor";

/**
 * Apply a structural table op as ONE whole-table replace, robust to an open inline
 * cell editor. It FIRST commits that editor (so its in-progress edit lands in the doc
 * with valid offsets), then RE-RESOLVES + RE-PARSES the table from the live doc before
 * applying `op`. This avoids the stale-offset corruption that occurs if the editor is
 * instead flushed by the widget's `destroy()` AFTER the op has already rewritten the
 * table (an adversarial-review finding). `anchor` is any position inside the table —
 * its start offset is stable across a cell edit. Returns false (no dispatch) when the
 * table can't be resolved or the op is a no-op (returns the same model ref).
 */
export function replaceTable(
  view: EditorView,
  anchor: number,
  op: (m: TableModel) => TableModel,
): boolean {
  commitCellEditor(); // flush an open cell editor with VALID offsets first
  const tbl = tableBlockAt(view.state, anchor);
  if (!tbl) return false;
  const fresh = parseTable(view.state.sliceDoc(tbl.from, tbl.to), tbl.from);
  const m2 = op(fresh);
  if (m2 === fresh) return false; // no-op (e.g. an out-of-range move)
  view.dispatch({ changes: { from: tbl.from, to: tbl.to, insert: serialize(m2) } });
  return true;
}
