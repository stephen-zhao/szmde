import { EditorSelection, type StateCommand } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  parseTable,
  serialize,
  splitRow,
  insertRow,
  deleteRow,
  insertCol,
  deleteCol,
  moveRow,
  moveCol,
  toggleHeader,
  makeTable,
  type TableModel,
} from "./table-model";

/**
 * CodeMirror commands for structured table editing (M5). They resolve the GFM
 * `Table` at the caret from the live syntax tree, so they're robust to edits, and
 * `return false` to pass the key through when the caret isn't in/adjacent to a table.
 */

/** The block `[from, to]` (whole lines) of the `Table` containing `pos`, else null. */
export function tableBlockAt(
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

// --- Structural edits (insert/delete/move rows & columns) — REQ-TBLED-3/-5 -------

interface Loc {
  row: number; // -1 = header (or the delimiter line), 0+ = body row index
  col: number;
}

/** The caret's row + column within a table block (`row` -1 = header/delimiter line). */
export function locate(state: Parameters<StateCommand>[0]["state"], tblFrom: number, pos: number): Loc {
  const startLine = state.doc.lineAt(tblFrom).number;
  const lineIdx = state.doc.lineAt(pos).number - startLine; // 0=header,1=delimiter,2+=body
  const line = state.doc.lineAt(pos);
  const cells = splitRow(line.text, line.from);
  let col = 0;
  for (let i = 0; i < cells.length; i++) if (pos >= cells[i].from) col = i;
  return { row: lineIdx <= 1 ? -1 : lineIdx - 2, col };
}

/** The absolute source offset of the cell at (row, col) in a (re-parsed) model, so
 *  the caret can be re-placed in the same logical cell after a whole-table rewrite. */
function cellOffset(m: TableModel, row: number, col: number): number {
  const cells = row < 0 ? m.header : (m.rows[Math.min(row, m.rows.length - 1)] ?? m.header);
  return (cells[Math.min(col, cells.length - 1)] ?? cells[0])?.from ?? m.from;
}

/**
 * A structural table command: resolve the Table + the caret's cell, apply a pure
 * model op, serialize, dispatch ONE whole-table replace, and re-place the caret in
 * the logical cell `caret(loc)` of the new table. Works in any render mode (the
 * source is there); `return false` (passes the key through) when not in a table or
 * the op is a no-op (e.g. deleting the header row).
 */
function structuralCommand(
  apply: (m: TableModel, loc: Loc) => TableModel,
  caret: (loc: Loc) => Loc,
): StateCommand {
  return ({ state, dispatch }) => {
    const pos = state.selection.main.head;
    const tbl = tableBlockAt(state, pos);
    if (!tbl) return false;
    const loc = locate(state, tbl.from, pos);
    const m = parseTable(state.doc.sliceString(tbl.from, tbl.to), tbl.from);
    const m2 = apply(m, loc);
    if (m2 === m) return false; // no-op (op returned the same model)
    const insert = serialize(m2);
    const reparsed = parseTable(insert, tbl.from);
    const c = caret(loc);
    dispatch(
      state.update({
        changes: { from: tbl.from, to: tbl.to, insert },
        selection: EditorSelection.cursor(cellOffset(reparsed, c.row, c.col)),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  };
}

/**
 * Tidy the table at the caret: re-serialize it to canonical FITTED GFM (single-space
 * cells, minimal `---` delimiter with alignment colons) — REQ-TBLED-6. Structural ops
 * already tidy as a side effect; this is the explicit command for a hand-typed messy
 * table (most useful in Source/Syntax mode). Returns false (passes the key through)
 * when not in a table or it's already tidy.
 */
export const tidyTable: StateCommand = ({ state, dispatch }) => {
  const tbl = tableBlockAt(state, state.selection.main.head);
  if (!tbl) return false;
  const src = state.doc.sliceString(tbl.from, tbl.to);
  const tidied = serialize(parseTable(src, tbl.from));
  if (tidied === src) return false; // already canonical
  dispatch(
    state.update({
      changes: { from: tbl.from, to: tbl.to, insert: tidied },
      userEvent: "input",
    }),
  );
  return true;
};

/**
 * Toggle the header row of the table at the caret on/off (REQ-TBLED-2, M5 S7). A
 * populated header is demoted into the first body row (blanked, still valid GFM); a
 * blank header pulls the first body row up. One whole-table replace; the caret lands in
 * the first header cell. Returns false (passes the key through) outside a table or on a
 * no-op (a blank header with no body row to promote).
 */
export const toggleTableHeader: StateCommand = ({ state, dispatch }) => {
  const tbl = tableBlockAt(state, state.selection.main.head);
  if (!tbl) return false;
  const m = parseTable(state.doc.sliceString(tbl.from, tbl.to), tbl.from);
  const m2 = toggleHeader(m);
  if (m2 === m) return false; // no-op (blank header, no body row)
  const insert = serialize(m2);
  const reparsed = parseTable(insert, tbl.from);
  dispatch(
    state.update({
      changes: { from: tbl.from, to: tbl.to, insert },
      selection: EditorSelection.cursor(cellOffset(reparsed, -1, 0)), // first header cell
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

const body = (row: number) => Math.max(0, row); // header/delimiter (row<0) acts at body 0

export const insertRowBelow = structuralCommand(
  (m, l) => insertRow(m, body(l.row + 1)),
  (l) => ({ row: body(l.row + 1), col: l.col }),
);
export const insertRowAbove = structuralCommand(
  (m, l) => insertRow(m, body(l.row)),
  (l) => ({ row: body(l.row), col: l.col }),
);
export const deleteCurrentRow = structuralCommand(
  (m, l) => (l.row < 0 ? m : deleteRow(m, l.row)), // never the header
  (l) => ({ row: Math.max(0, l.row - 1), col: l.col }),
);
export const insertColRight = structuralCommand(
  (m, l) => insertCol(m, l.col + 1),
  (l) => ({ row: l.row, col: l.col + 1 }),
);
export const insertColLeft = structuralCommand(
  (m, l) => insertCol(m, l.col),
  (l) => l,
);
export const deleteCurrentCol = structuralCommand(
  (m, l) => deleteCol(m, l.col),
  (l) => ({ row: l.row, col: Math.max(0, l.col - 1) }),
);
export const moveRowDown = structuralCommand(
  (m, l) => (l.row < 0 ? m : moveRow(m, l.row, l.row + 1)),
  (l) => ({ row: l.row + 1, col: l.col }),
);
export const moveRowUp = structuralCommand(
  (m, l) => (l.row < 0 ? m : moveRow(m, l.row, l.row - 1)),
  (l) => ({ row: Math.max(0, l.row - 1), col: l.col }),
);
export const moveColRight = structuralCommand(
  (m, l) => moveCol(m, l.col, l.col + 1),
  (l) => ({ row: l.row, col: l.col + 1 }),
);
export const moveColLeft = structuralCommand(
  (m, l) => moveCol(m, l.col, l.col - 1),
  (l) => ({ row: l.row, col: Math.max(0, l.col - 1) }),
);

/**
 * Insert a fresh `rows`×`cols` GFM table as its own block at the caret (REQ-TBLED-1),
 * with the caret placed in the first header cell. The table is flanked by blank lines
 * so it parses as a block: on a blank line it's inserted there; otherwise a new block
 * is opened after the caret's line. Always succeeds (returns true).
 */
export function insertTable(rows: number, cols: number): StateCommand {
  return ({ state, dispatch }) => {
    const table = serialize(makeTable(rows, cols));
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    const docLen = state.doc.length;

    let from: number, to: number, lead: string, trail: string;
    if (docLen === 0) {
      from = 0;
      to = 0;
      lead = "";
      trail = "";
    } else if (line.text.trim() === "") {
      // Caret on a blank line: replace it, flanking the table with one newline each
      // side (the surrounding newlines + these make blank lines), trimmed at doc edges.
      from = line.from;
      to = line.to;
      lead = line.from === 0 ? "" : "\n";
      trail = line.to === docLen ? "" : "\n";
    } else {
      // Open a new block after the caret's line. A blank line before; and after, unless
      // the next line is already blank (or it's the document's end).
      from = line.to;
      to = line.to;
      lead = "\n\n";
      const nextBlank =
        line.number === state.doc.lines || state.doc.line(line.number + 1).text.trim() === "";
      trail = nextBlank ? "" : "\n\n";
    }

    const insert = lead + table + trail;
    const caret = from + lead.length + 2; // first header cell: past the opening "| "
    dispatch(
      state.update({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(caret),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  };
}
