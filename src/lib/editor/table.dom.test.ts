import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { renderInlineMarkdown } from "./tables";
import {
  insertRowBelow,
  insertRowAbove,
  deleteCurrentRow,
  insertColRight,
  insertColLeft,
  deleteCurrentCol,
  moveRowDown,
  moveRowUp,
  moveColRight,
  moveColLeft,
  tidyTable,
  insertTable,
  toggleTableHeader,
} from "./table-commands";
import { closeTableMenu } from "./table-menu";
import type { RenderMode } from "./render-mode";
import type { StateCommand } from "@codemirror/state";

// Rendered-DOM tests for GFM tables (M2 S5, render-only). Clean mode replaces the
// pipe-table source with a real <table> (block widget); the caret entering the
// table reveals the raw source for editing (the rich structured editing is the
// deferred §7.4 effort). happy-dom builds a real <table> we can walk.
let view: EditorView | undefined;
afterEach(() => {
  closeTableMenu(); // drop any open context menu + its document listeners
  view?.destroy();
  view = undefined;
});

function build(doc: string, mode: RenderMode = "clean", caret = 0): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: editorExtensions(true, mode),
    }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}

const text = (v: EditorView) => v.contentDOM.textContent ?? "";
const count = (v: EditorView, sel: string) => v.contentDOM.querySelectorAll(sel).length;
const cells = (v: EditorView, sel: string) =>
  [...v.contentDOM.querySelectorAll(sel)].map((c) => c.textContent);

// caret on line 0 (intro) so the table (lines 2+) renders rather than reveals.
const DOC = "intro\n\n| a | b |\n| - | :-: |\n| 1 | 2 |\n| 3 | 4 |";

describe("[REQ-TABLE-1] Tables — Clean (Formatted) mode renders a real table", () => {
  it("renders a <table> with header cells from TableHeader", () => {
    const v = build(DOC, "clean", 0);
    expect(count(v, "table.cm-md-table")).toBe(1);
    expect(cells(v, "table.cm-md-table thead th")).toEqual(["a", "b"]);
  });

  it("renders one body <tr> per TableRow with its cells", () => {
    const v = build(DOC, "clean", 0);
    expect(count(v, "table.cm-md-table tbody tr")).toBe(2);
    expect(cells(v, "table.cm-md-table tbody tr:first-child td")).toEqual(["1", "2"]);
  });

  it("applies per-column alignment parsed from the separator row", () => {
    const v = build(DOC, "clean", 0);
    const th = v.contentDOM.querySelectorAll<HTMLTableCellElement>("thead th");
    expect(th[0].style.textAlign).toBe(""); // `-` → default
    expect(th[1].style.textAlign).toBe("center"); // `:-:` → center
  });

  it("[REQ-TBLED-6] maps an EMPTY body cell to its correct column (alignment + count)", () => {
    // lezer drops the empty middle cell (emits no TableCell node); the model
    // reconstructs it from pipe geometry, so the 3 columns stay aligned and the
    // right-aligned col 'c' keeps its alignment instead of shifting onto '3'.
    const v = build("intro\n\n| a | b | c |\n| - | - | --: |\n| 1 |  | 3 |", "clean", 0);
    expect(cells(v, "tbody tr td")).toEqual(["1", "", "3"]); // the empty slot is kept
    const td = v.contentDOM.querySelectorAll<HTMLTableCellElement>("tbody td");
    expect(td[2].style.textAlign).toBe("right"); // '3' is col 2 (--:), not mis-mapped to col 1
  });

  it("renders a header-only table without crashing (0 body rows)", () => {
    const v = build("intro\n\n| a |\n| - |", "clean", 0);
    expect(count(v, "table.cm-md-table")).toBe(1);
    expect(count(v, "tbody tr")).toBe(0);
  });

  it("applies right alignment from a `--:` separator column", () => {
    const v = build("intro\n\n| a |\n| --: |\n| 1 |", "clean", 0);
    expect(v.contentDOM.querySelector<HTMLTableCellElement>("thead th")?.style.textAlign).toBe(
      "right",
    );
  });

  it("reuses the <table> DOM across an edit after it (TableWidget.eq)", () => {
    const v = build(DOC + "\n\noutro", "clean", DOC.length + 4); // caret in the trailer
    const before = v.contentDOM.querySelector("table.cm-md-table");
    expect(before).not.toBeNull();
    const end = v.state.doc.length;
    v.dispatch({ changes: { from: end, insert: "!" }, selection: EditorSelection.cursor(end + 1) });
    forceParsing(v, v.state.doc.length, 5000);
    expect(v.contentDOM.querySelector("table.cm-md-table")).toBe(before);
  });
});

describe("[REQ-TABLE-2] Tables — stays rendered while editing, + other modes", () => {
  it("[REQ-TBLED-7] stays RENDERED even with the caret in its line range (no reveal)", () => {
    const v = build(DOC, "clean", 12); // a position within the table's lines
    expect(count(v, "table.cm-md-table")).toBe(1); // no longer flips to raw pipes
  });

  it("makes the rendered table atomic", () => {
    const v = build(DOC, "clean", 0);
    let total = 0;
    for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
    expect(total).toBeGreaterThan(0);
  });

  it("Source mode keeps the literal pipe text (no <table>)", () => {
    const v = build(DOC, "markers-rendered", 0);
    expect(count(v, "table.cm-md-table")).toBe(0);
    expect(text(v)).toContain("| a | b |");
  });

  it("Syntax mode keeps the literal pipe text (no <table>)", () => {
    const v = build(DOC, "markers-syntax", 0);
    expect(count(v, "table.cm-md-table")).toBe(0);
    expect(text(v)).toContain("| a | b |");
  });

  it("[REQ-TBLED-7] clicking a cell opens an inline editor; the table stays rendered", () => {
    const v = build(DOC, "clean", 0);
    const td = v.contentDOM.querySelector<HTMLTableCellElement>("table.cm-md-table tbody td")!;
    td.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const ta = td.querySelector<HTMLTextAreaElement>("textarea.cm-md-cell-editor");
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe("1"); // prefilled with the cell's source
    expect(count(v, "table.cm-md-table")).toBe(1); // table NOT revealed
  });

  it("renders inline markdown inside cells (bold/italic/code)", () => {
    const v = build("intro\n\n| a | b |\n| - | - |\n| **x** | `y` |", "clean", 0);
    expect(v.contentDOM.querySelector("table.cm-md-table td strong")?.textContent).toBe("x");
    expect(v.contentDOM.querySelector("table.cm-md-table td code")?.textContent).toBe("y");
  });
});

describe("[REQ-TBLED-3][REQ-TBLED-5] structural table commands", () => {
  const TBL = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |";
  const DELIM = "| --- | --- | --- |"; // tables re-serialize fitted on every edit
  const run = (v: EditorView, cmd: StateCommand) => cmd({ state: v.state, dispatch: (tr) => v.dispatch(tr) });
  const withCaretOn = (chr: string) => {
    const v = build(TBL, "clean", 0);
    v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf(chr) } });
    return v;
  };
  const doc = (v: EditorView) => v.state.doc.toString();

  it("insertRowBelow inserts an empty row after the caret's row", () => {
    const v = withCaretOn("2"); // body row 0
    expect(run(v, insertRowBelow)).toBe(true);
    expect(doc(v)).toBe(`| a | b | c |\n${DELIM}\n| 1 | 2 | 3 |\n|  |  |  |\n| 4 | 5 | 6 |`);
  });
  it("insertRowAbove inserts before the caret's row", () => {
    const v = withCaretOn("2");
    run(v, insertRowAbove);
    expect(doc(v)).toBe(`| a | b | c |\n${DELIM}\n|  |  |  |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |`);
  });
  it("deleteCurrentRow removes the caret's body row", () => {
    const v = withCaretOn("2");
    run(v, deleteCurrentRow);
    expect(doc(v)).toBe(`| a | b | c |\n${DELIM}\n| 4 | 5 | 6 |`);
  });
  it("deleteCurrentRow is a no-op on the header row (returns false)", () => {
    const v = withCaretOn("a"); // header
    expect(run(v, deleteCurrentRow)).toBe(false);
    expect(doc(v)).toBe(TBL); // untouched
  });
  it("insertColRight inserts an empty column after the caret's column", () => {
    const v = withCaretOn("2"); // col 1
    run(v, insertColRight);
    expect(doc(v)).toBe(`| a | b |  | c |\n| --- | --- | --- | --- |\n| 1 | 2 |  | 3 |\n| 4 | 5 |  | 6 |`);
  });
  it("insertColLeft inserts before the caret's column", () => {
    const v = withCaretOn("2");
    run(v, insertColLeft);
    expect(doc(v).split("\n")[0]).toBe("| a |  | b | c |");
  });
  it("deleteCurrentCol removes the caret's column", () => {
    const v = withCaretOn("2"); // col 1
    run(v, deleteCurrentCol);
    expect(doc(v)).toBe("| a | c |\n| --- | --- |\n| 1 | 3 |\n| 4 | 6 |");
  });
  it("moveRowDown / moveRowUp swap adjacent body rows", () => {
    const down = withCaretOn("2"); // body row 0
    run(down, moveRowDown);
    expect(doc(down)).toBe(`| a | b | c |\n${DELIM}\n| 4 | 5 | 6 |\n| 1 | 2 | 3 |`);
    const up = withCaretOn("5"); // body row 1
    run(up, moveRowUp);
    expect(doc(up)).toBe(`| a | b | c |\n${DELIM}\n| 4 | 5 | 6 |\n| 1 | 2 | 3 |`);
  });
  it("moveColRight / moveColLeft reorder columns across all rows", () => {
    const right = withCaretOn("2"); // col 1 → 2
    run(right, moveColRight);
    expect(doc(right)).toBe(`| a | c | b |\n${DELIM}\n| 1 | 3 | 2 |\n| 4 | 6 | 5 |`);
    const left = withCaretOn("2"); // col 1 → 0
    run(left, moveColLeft);
    expect(doc(left)).toBe(`| b | a | c |\n${DELIM}\n| 2 | 1 | 3 |\n| 5 | 4 | 6 |`);
  });
  it("returns false when the caret is not in a table", () => {
    const v = build("just text", "clean", 0);
    expect(run(v, insertRowBelow)).toBe(false);
  });
});

describe("[REQ-TBLED-1] insertTable — create a table from scratch", () => {
  const run = (v: EditorView, cmd: StateCommand) => cmd({ state: v.state, dispatch: (tr) => v.dispatch(tr) });
  const doc = (v: EditorView) => v.state.doc.toString();
  const T22 = "|  |  |\n| --- | --- |\n|  |  |"; // makeTable(2,2): header + 1 body, 2 cols

  it("into an empty document inserts just the table, caret in the first cell", () => {
    const v = build("", "markers-rendered", 0);
    expect(run(v, insertTable(2, 2))).toBe(true);
    expect(doc(v)).toBe(T22);
    expect(v.state.selection.main.head).toBe(2); // inside "| ▏ |"
  });

  it("after a text line opens a new block separated by a blank line", () => {
    const v = build("intro", "markers-rendered", 3);
    run(v, insertTable(2, 2));
    expect(doc(v)).toBe(`intro\n\n${T22}`);
    expect(v.state.selection.main.head).toBe(9); // first cell of the new table
  });

  it("on a blank line between paragraphs flanks the table with blank lines", () => {
    const v = build("a\n\nb", "markers-rendered", 2); // caret on the blank line
    run(v, insertTable(2, 2));
    expect(doc(v)).toBe(`a\n\n${T22}\n\nb`);
  });

  it("builds the requested dimensions (3×4)", () => {
    const v = build("", "markers-rendered", 0);
    run(v, insertTable(3, 4));
    expect(doc(v)).toBe(
      "|  |  |  |  |\n| --- | --- | --- | --- |\n|  |  |  |  |\n|  |  |  |  |",
    );
  });
});

describe("[REQ-TBLED-6] tidyTable — explicit canonicalize command", () => {
  const run = (v: EditorView, cmd: StateCommand) => cmd({ state: v.state, dispatch: (tr) => v.dispatch(tr) });
  // Source mode so a hand-typed messy table stays raw text the caret can sit inside.
  it("re-serializes a hand-typed messy table to canonical fitted GFM", () => {
    const MESSY = "intro\n\n|a|b|\n|-|:-:|\n|1|2|";
    const v = build(MESSY, "markers-rendered", MESSY.indexOf("a"));
    expect(run(v, tidyTable)).toBe(true);
    expect(v.state.doc.toString()).toBe("intro\n\n| a | b |\n| --- | :-: |\n| 1 | 2 |");
  });
  it("returns false (passes through) on an already-tidy table", () => {
    const TIDY = "intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
    const v = build(TIDY, "markers-rendered", TIDY.indexOf("a"));
    expect(run(v, tidyTable)).toBe(false);
    expect(v.state.doc.toString()).toBe(TIDY);
  });
  it("returns false when the caret is not in a table", () => {
    const v = build("just text", "markers-rendered", 0);
    expect(run(v, tidyTable)).toBe(false);
  });
});

describe("[REQ-TBLED-2] toggleTableHeader — command toggles the header on/off", () => {
  const run = (v: EditorView, cmd: StateCommand) => cmd({ state: v.state, dispatch: (tr) => v.dispatch(tr) });
  const TBL = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |"; // Source mode: caret sits in the raw pipes

  it("OFF: demotes a populated header into the first body row + blanks it (nothing lost)", () => {
    const v = build(TBL, "markers-rendered", TBL.indexOf("a")); // caret in the header
    expect(run(v, toggleTableHeader)).toBe(true);
    expect(v.state.doc.toString()).toBe("intro\n\n|  |  |\n| --- | --- |\n| a | b |\n| 1 | 2 |");
  });
  it("round-trips off→on back to the tidy original", () => {
    const v = build(TBL, "markers-rendered", TBL.indexOf("a"));
    run(v, toggleTableHeader); // off (caret is left in the first header cell)
    forceParsing(v, v.state.doc.length, 5000); // re-parse the new doc so tableBlockAt resolves
    run(v, toggleTableHeader); // on
    expect(v.state.doc.toString()).toBe("intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  });
  it("returns false when the caret is not in a table", () => {
    const v = build("just text", "markers-rendered", 0);
    expect(run(v, toggleTableHeader)).toBe(false);
  });
});

describe("[REQ-TBLED-3][REQ-TBLED-5][REQ-TBLED-6] right-click table context menu", () => {
  // Formatted-mode structural-edit UI: right-click a cell → a menu of every op for
  // that cell's row + column. The op is a whole-table replace; the caret stays
  // outside the block, so the rendered table updates in place. (The hover "+"
  // gizmos are a separate convenience.)
  const MDOC = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |"; // caret on line 0 → renders
  const TIDY = "intro\n\n| a | b |\n| --- | --- |"; // delimiter after a re-serialize

  const bodyCell = (v: EditorView, i = 0) =>
    v.contentDOM.querySelectorAll<HTMLTableCellElement>("tbody td")[i];
  const headerCell = (v: EditorView, i = 0) =>
    v.contentDOM.querySelectorAll<HTMLTableCellElement>("thead th")[i];
  const rightClick = (cell: Element) =>
    cell.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 11, clientY: 13 }),
    );
  const menuOf = (v: EditorView) => v.dom.querySelector<HTMLElement>(".cm-md-table-menu");
  const itemEls = (v: EditorView) => [...v.dom.querySelectorAll<HTMLButtonElement>(".cm-md-table-menu-item")];
  const itemEl = (v: EditorView, label: string) => itemEls(v).find((b) => b.textContent === label)!;
  const clickItem = (v: EditorView, label: string) =>
    itemEl(v, label).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  const doc = (v: EditorView) => v.state.doc.toString();

  it("right-clicking a cell opens a menu (inside the editor wrapper) with the ops", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    const menu = menuOf(v);
    expect(menu).not.toBeNull();
    expect(menu!.style.left).toBe("11px"); // positioned at the click (clientX/clientY)
    expect(menu!.style.top).toBe("13px");
    const labels = itemEls(v).map((b) => b.textContent);
    for (const l of ["Insert row below", "Delete row", "Insert column right", "Delete column", "Align center"])
      expect(labels).toContain(l);
  });

  it("resolves the cell even when right-clicking an inline segment inside it", () => {
    const v = build("intro\n\n| a | b |\n| - | - |\n| **x** | y |", "clean", 0);
    const strong = v.contentDOM.querySelector("tbody td strong")!;
    rightClick(strong); // target is the <strong>, not the <td>
    expect(menuOf(v)).not.toBeNull(); // closest('[data-row]') still finds the cell
  });

  it("does NOT open a menu when the right-click misses every cell", () => {
    const v = build(MDOC, "clean", 0);
    const table = v.contentDOM.querySelector("table.cm-md-table")!;
    rightClick(table); // target is the <table>, which has no data-row
    expect(menuOf(v)).toBeNull();
  });

  it("a real right-click (mousedown button 2 → contextmenu) keeps the table rendered", () => {
    // Regression: a right-click's mousedown fires BEFORE its contextmenu. If that
    // mousedown moved the caret into the cell, the table would reveal to source
    // before the menu opened (and the op would flicker). The button-2 guard stops it.
    const v = build(MDOC, "clean", 0);
    const td = bodyCell(v, 0);
    td.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 }));
    expect(v.state.selection.main.head).toBe(0); // caret did NOT jump into the cell
    expect(count(v, "table.cm-md-table")).toBe(1); // table still rendered
    rightClick(td); // contextmenu → menu over the still-rendered table
    expect(menuOf(v)).not.toBeNull();
    clickItem(v, "Insert row below");
    forceParsing(v, v.state.doc.length, 5000);
    expect(count(v, "table.cm-md-table")).toBe(1); // applied in place, NOT revealed
    expect(v.state.selection.main.head).toBe(0); // caret stayed outside the block
  });

  it("[REQ-TBLED-2] 'Toggle header row' demotes the header into a body row, in place", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    clickItem(v, "Toggle header row");
    forceParsing(v, v.state.doc.length, 5000);
    expect(doc(v)).toBe("intro\n\n|  |  |\n| --- | --- |\n| a | b |\n| 1 | 2 |");
    expect(count(v, "table.cm-md-table")).toBe(1); // applied in place, still rendered
  });

  it("'Insert row below' adds an empty body row after the clicked row", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    clickItem(v, "Insert row below");
    expect(doc(v)).toBe(`${TIDY}\n| 1 | 2 |\n|  |  |`);
    expect(menuOf(v)).toBeNull(); // applying closes the menu
  });

  it("'Insert row above' adds an empty body row before the clicked row", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    clickItem(v, "Insert row above");
    expect(doc(v)).toBe(`${TIDY}\n|  |  |\n| 1 | 2 |`);
  });

  it("'Delete row' removes the clicked body row", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    clickItem(v, "Delete row");
    expect(doc(v)).toBe(TIDY);
  });

  it("disables header-nonsensical row ops, keeps the meaningful ones", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(headerCell(v, 0));
    expect(itemEl(v, "Delete row").disabled).toBe(true);
    expect(itemEl(v, "Move row up").disabled).toBe(true);
    expect(itemEl(v, "Move row down").disabled).toBe(true);
    expect(itemEl(v, "Insert row above").disabled).toBe(true); // nothing above a header
    expect(itemEl(v, "Insert row below").disabled).toBe(false); // adds the first body row
    expect(itemEl(v, "Insert column right").disabled).toBe(false); // column ops still apply
  });

  it("'Insert row below' on the header adds a body row right under it", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(headerCell(v, 0));
    clickItem(v, "Insert row below");
    expect(doc(v)).toBe(`${TIDY}\n|  |  |\n| 1 | 2 |`); // new blank row before '1 2'
  });

  it("'Insert column right' / 'Delete column' edit the clicked column", () => {
    const ins = build(MDOC, "clean", 0);
    rightClick(bodyCell(ins, 0)); // column 0
    clickItem(ins, "Insert column right");
    expect(doc(ins)).toBe("intro\n\n| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |");

    const del = build(MDOC, "clean", 0);
    rightClick(bodyCell(del, 0));
    clickItem(del, "Delete column");
    expect(doc(del)).toBe("intro\n\n| b |\n| --- |\n| 2 |");
  });

  it("'Align center' rewrites the clicked column's delimiter", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 1)); // column 1
    clickItem(v, "Align center");
    expect(doc(v)).toBe("intro\n\n| a | b |\n| --- | :-: |\n| 1 | 2 |");
  });

  it("'Move row down' / 'Move column right' reorder via the menu", () => {
    const MD2 = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |";
    const rows = build(MD2, "clean", 0);
    rightClick(bodyCell(rows, 0)); // body row 0 ('1 2')
    clickItem(rows, "Move row down");
    expect(doc(rows)).toBe("intro\n\n| a | b |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |");

    const cols = build(MD2, "clean", 0);
    rightClick(bodyCell(cols, 0)); // column 0
    clickItem(cols, "Move column right");
    expect(doc(cols)).toBe("intro\n\n| b | a |\n| --- | --- |\n| 2 | 1 |\n| 4 | 3 |");

    const up = build(MD2, "clean", 0);
    rightClick(bodyCell(up, 2)); // body row 1 ('3 4'), col 0
    clickItem(up, "Move row up");
    expect(doc(up)).toBe("intro\n\n| a | b |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |");
  });

  it("a no-op op (move column 0 left) leaves the doc untouched and closes the menu", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0)); // column 0 — cannot move further left
    clickItem(v, "Move column left");
    expect(doc(v)).toBe(MDOC); // unchanged (no dispatch — source not even tidied)
    expect(menuOf(v)).toBeNull();
  });

  it("clicking outside the menu dismisses it", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    expect(menuOf(v)).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menuOf(v)).toBeNull();
  });

  it("Escape dismisses the menu; other keys leave it open", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(menuOf(v)).not.toBeNull(); // unrelated key — still open
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menuOf(v)).toBeNull();
  });

  it("opening a second menu replaces the first (only one at a time)", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    rightClick(bodyCell(v, 1));
    expect(v.dom.querySelectorAll(".cm-md-table-menu").length).toBe(1);
  });

  it("destroying the table widget (table removed) closes a stray menu", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    expect(menuOf(v)).not.toBeNull();
    // Replace the table with plain text → the widget is removed → destroy() runs.
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "just text" } });
    forceParsing(v, v.state.doc.length, 5000);
    expect(count(v, "table.cm-md-table")).toBe(0); // table gone
    expect(menuOf(v)).toBeNull(); // widget.destroy() dropped the menu
  });
});

describe("[REQ-TBLED-3] hover insert-gizmos on table edges", () => {
  // Formatted-mode "+" affordances: column-insert handles on the header strip,
  // row-insert handles in the left gutter. Each is a whole-table replace with the
  // caret left outside, so the table updates in place. (Hover/opacity is CSS — not
  // exercised here; happy-dom can still see the elements + dispatch their mousedown.)
  const MDOC = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |";
  const TIDY = "intro\n\n| a | b |\n| --- | --- |";
  const doc = (v: EditorView) => v.state.doc.toString();
  const mdown = (el: Element) =>
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  const giz = (v: EditorView, sel: string, i = 0) =>
    v.contentDOM.querySelectorAll<HTMLButtonElement>(sel)[i];

  it("puts a column-insert handle on each header cell (+ a leading one on the first)", () => {
    const v = build(MDOC, "clean", 0);
    expect(count(v, "thead .cm-tbl-gizmo-col")).toBe(2); // one per header column
    expect(count(v, "thead .cm-tbl-gizmo-colstart")).toBe(1); // only the first cell
  });

  it("puts a row-insert handle only on the left-column cells", () => {
    const v = build(MDOC, "clean", 0);
    expect(count(v, ".cm-tbl-gizmo-row")).toBe(2); // header + 1 body row, first column
    expect(count(v, "thead th:not(:first-child) .cm-tbl-gizmo-row")).toBe(0);
    expect(count(v, "tbody td:not(:first-child) .cm-tbl-gizmo-row")).toBe(0);
  });

  it("the '+' glyph is CSS-only (never in a cell's textContent)", () => {
    const v = build(MDOC, "clean", 0);
    expect(cells(v, "thead th")).toEqual(["a", "b"]); // no stray '+'
  });

  it("[REQ-TBLED-4] places a drag grip on each header cell + each body row", () => {
    const v = build(MDOC, "clean", 0);
    expect(count(v, "thead th .cm-tbl-drag-col")).toBe(2); // one per column
    expect(count(v, "tbody tr .cm-tbl-drag-row")).toBe(1); // one per body row
    expect(count(v, "thead .cm-tbl-drag-row")).toBe(0); // header isn't a draggable row
  });

  it("[REQ-TBLED-4] a grip swallows mousedown so the drag's compat-mousedown can't reveal", () => {
    // A real pointer drag also fires a compatibility mousedown on the grip; if it
    // reached the table's reveal handler the table would flip to source mid-drag.
    const v = build(MDOC, "clean", 0);
    const grip = v.contentDOM.querySelector(".cm-tbl-drag-row")!;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(count(v, "table.cm-md-table")).toBe(1); // still rendered
    expect(v.state.selection.main.head).toBe(0); // caret never entered the table
  });

  it("a header column handle inserts a column to its right", () => {
    const v = build(MDOC, "clean", 0);
    mdown(giz(v, "thead th .cm-tbl-gizmo-col")); // first header cell, right edge
    expect(doc(v)).toBe("intro\n\n| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |");
  });

  it("the leading-column handle inserts a column at the start", () => {
    const v = build(MDOC, "clean", 0);
    mdown(giz(v, ".cm-tbl-gizmo-colstart"));
    expect(doc(v)).toBe("intro\n\n|  | a | b |\n| --- | --- | --- |\n|  | 1 | 2 |");
  });

  it("the header's row handle inserts the first body row", () => {
    const v = build(MDOC, "clean", 0);
    mdown(giz(v, "thead .cm-tbl-gizmo-row"));
    expect(doc(v)).toBe(`${TIDY}\n|  |  |\n| 1 | 2 |`);
  });

  it("a body row's handle inserts a row below it", () => {
    const v = build(MDOC, "clean", 0);
    mdown(giz(v, "tbody tr:first-child .cm-tbl-gizmo-row"));
    expect(doc(v)).toBe(`${TIDY}\n| 1 | 2 |\n|  |  |`);
  });

  it("a gizmo insert keeps the table rendered with the caret outside", () => {
    const v = build(MDOC, "clean", 0);
    mdown(giz(v, "thead th .cm-tbl-gizmo-col"));
    forceParsing(v, v.state.doc.length, 5000);
    expect(count(v, "table.cm-md-table")).toBe(1); // applied in place, not revealed
    expect(v.state.selection.main.head).toBe(0); // caret never entered the table
  });

  it("a non-primary click on a gizmo does not insert (falls through to the menu)", () => {
    const v = build(MDOC, "clean", 0);
    const before = doc(v);
    const g = giz(v, "thead th .cm-tbl-gizmo-col");
    // Right-click (button 2) on the gizmo must NOT insert...
    g.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 }));
    expect(doc(v)).toBe(before); // unchanged
    // ...and the contextmenu (on the gizmo, which lives inside a cell) opens the menu.
    g.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(v.dom.querySelector(".cm-md-table-menu")).not.toBeNull();
  });
});

describe("[REQ-TABLE-1] renderInlineMarkdown — cell inline tokens", () => {
  const render = (s: string) => {
    const d = document.createElement("div");
    renderInlineMarkdown(d, s);
    return d;
  };
  it("renders each inline construct + surrounding text", () => {
    expect(render("a **b** c").querySelector("strong")?.textContent).toBe("b");
    expect(render("~~s~~").querySelector("del")?.textContent).toBe("s");
    expect(render("`c`").querySelector("code")?.textContent).toBe("c");
    expect(render("*i*").querySelector("em")?.textContent).toBe("i");
    expect(render("_u_").querySelector("em")?.textContent).toBe("u");
    const a = render("[t](http://x)").querySelector("a");
    expect(a?.textContent).toBe("t");
    expect(a?.getAttribute("href")).toBe("http://x");
  });
  it("wraps plain text in a segment span (carries data-seg-from)", () => {
    const d = render("just text");
    expect(d.textContent).toBe("just text");
    expect(d.querySelector("[data-seg-from]")?.getAttribute("data-seg-from")).toBe("0");
  });
});
