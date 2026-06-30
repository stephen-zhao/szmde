import { EditorSelection, type StateCommand } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";

/**
 * CodeMirror commands for structured table editing (M5). They resolve the GFM
 * `Table` at the caret from the live syntax tree, so they're robust to edits, and
 * `return false` to pass the key through when the caret isn't in/adjacent to a table.
 */

/** The block `[from, to]` (whole lines) of the `Table` containing `pos`, else null. */
function tableBlockAt(
  state: Parameters<StateCommand>[0]["state"],
  pos: number,
): { from: number; to: number } | null {
  const tree = syntaxTree(state);
  for (
    let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (n.name === "Table") {
      return { from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to };
    }
  }
  return null;
}

/**
 * ArrowDown / ArrowUp into a RENDERED table. CM treats the table's block widget as
 * atomic and skips over it, so the caret could never get inside. When the caret is
 * on the line directly adjacent to a rendered table (Clean mode), move it INTO the
 * table's source instead — which trips reveal-on-cursor (tables.ts) so the cell is
 * editable. Down enters at the top row, Up at the bottom row (REQ-TBLED-7).
 */
function enterTable(dir: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    const sel = state.selection.main;
    if (state.facet(renderMode) !== "clean" || !sel.empty) return false;
    const adj = state.doc.lineAt(sel.head).number + dir;
    if (adj < 1 || adj > state.doc.lines) return false;
    const tbl = tableBlockAt(state, state.doc.line(adj).from);
    if (!tbl || (sel.head >= tbl.from && sel.head <= tbl.to)) return false;
    const pos = dir === 1 ? tbl.from : state.doc.lineAt(tbl.to).from;
    dispatch(state.update({ selection: EditorSelection.cursor(pos), scrollIntoView: true }));
    return true;
  };
}

export const enterTableDown = enterTable(1);
export const enterTableUp = enterTable(-1);
