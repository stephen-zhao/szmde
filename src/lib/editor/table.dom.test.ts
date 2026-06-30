import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { renderInlineMarkdown } from "./tables";
import {
  enterTableDown,
  enterTableUp,
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

describe("[REQ-TABLE-2] Tables — reveal-to-source and other modes", () => {
  it("reveals the raw pipe source when the caret is inside the table", () => {
    const v = build(DOC, "clean", 12); // caret within the header row
    expect(count(v, "table.cm-md-table")).toBe(0);
    expect(text(v)).toContain("| a | b |");
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

  it("reveals the source with the caret in the table when clicked", () => {
    const v = build(DOC, "clean", 0); // table rendered (caret on line 0)
    const table = v.contentDOM.querySelector("table.cm-md-table")!;
    table.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    // caret lands at the table's start (line 2) → the table reveals to source.
    expect(v.state.selection.main.head).toBe(v.state.doc.line(3).from);
    expect(count(v, "table.cm-md-table")).toBe(0);
  });

  it("clicking a cell reveals the source with the caret in THAT cell", () => {
    const v = build(DOC, "clean", 0);
    const td = v.contentDOM.querySelector<HTMLTableCellElement>("table.cm-md-table tbody td")!;
    const from = Number(td.dataset.cellFrom);
    expect(from).toBeGreaterThan(0);
    td.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(v.state.selection.main.head).toBe(from); // caret in the clicked cell's source
    // and it points at the right cell content:
    expect(v.state.doc.sliceString(from, from + 1)).toBe("1");
  });

  it("[REQ-TBLED-7] clicking a glyph in a FORMATTED cell maps to that source char", () => {
    // The M2 deferral: a click inside `**x**` used to land at the cell start. Now each
    // segment carries data-seg-from, so it maps to the exact source char.
    const v = build("intro\n\n| a | b |\n| - | - |\n| **x** | y |", "clean", 0);
    const seg = v.contentDOM.querySelector<HTMLElement>("table.cm-md-table td strong")!;
    const segFrom = Number(seg.dataset.segFrom);
    expect(v.state.doc.sliceString(segFrom, segFrom + 1)).toBe("x"); // points at 'x' in **x**
    seg.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(v.state.selection.main.head).toBe(segFrom); // caret on the 'x' source char
  });

  it("renders inline markdown inside cells (bold/italic/code)", () => {
    const v = build("intro\n\n| a | b |\n| - | - |\n| **x** | `y` |", "clean", 0);
    expect(v.contentDOM.querySelector("table.cm-md-table td strong")?.textContent).toBe("x");
    expect(v.contentDOM.querySelector("table.cm-md-table td code")?.textContent).toBe("y");
  });
});

describe("[REQ-TBLED-7] arrow keys enter a rendered table", () => {
  const DOC2 = "intro\n\n| a | b |\n| - | :-: |\n| 1 | 2 |";
  const at = (v: EditorView, lineNum: number) => {
    v.dispatch({ selection: { anchor: v.state.doc.line(lineNum).from } });
    return v;
  };
  const run = (v: EditorView, cmd: StateCommand) =>
    cmd({ state: v.state, dispatch: (tr) => v.dispatch(tr) });

  it("ArrowDown from the line above enters the table (reveals its source)", () => {
    const v = at(build(DOC2, "clean", 0), 2); // the blank line directly above the table
    expect(run(v, enterTableDown)).toBe(true);
    expect(v.state.selection.main.head).toBe(v.state.doc.line(3).from); // first table line
    expect(count(v, "table.cm-md-table")).toBe(0); // revealed
  });

  it("ArrowUp from the line below enters the table", () => {
    const v = at(build("| a | b |\n| - | - |\n| 1 | 2 |\n\nend", "clean", 0), 4); // blank below
    expect(run(v, enterTableUp)).toBe(true);
    expect(v.state.selection.main.head).toBe(v.state.doc.line(3).from); // last table line
  });

  it("returns false off a table edge (normal nav)", () => {
    expect(run(at(build(DOC2, "clean", 0), 1), enterTableDown)).toBe(false); // intro line
  });

  it("returns false at the document edge (no line above)", () => {
    expect(run(at(build(DOC2, "clean", 0), 1), enterTableUp)).toBe(false);
  });

  it("returns false in non-Clean mode (raw text nav)", () => {
    expect(run(at(build(DOC2, "markers-syntax", 0), 2), enterTableDown)).toBe(false);
  });

  it("returns false when the caret is already inside the table", () => {
    expect(run(at(build(DOC2, "clean", 0), 3), enterTableDown)).toBe(false);
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

  it("disables row ops on a header cell (no body row to act on)", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(headerCell(v, 0));
    expect(itemEl(v, "Delete row").disabled).toBe(true);
    expect(itemEl(v, "Move row up").disabled).toBe(true);
    expect(itemEl(v, "Move row down").disabled).toBe(true);
    expect(itemEl(v, "Insert column right").disabled).toBe(false); // column ops still apply
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

  it("destroying the table widget (caret revealing it) closes a stray menu", () => {
    const v = build(MDOC, "clean", 0);
    rightClick(bodyCell(v, 0));
    expect(menuOf(v)).not.toBeNull();
    // Move the caret into the table → the widget is removed (reveal) → destroy().
    v.dispatch({ selection: { anchor: v.state.doc.line(3).from } });
    expect(count(v, "table.cm-md-table")).toBe(0); // revealed to source
    expect(menuOf(v)).toBeNull(); // widget.destroy() dropped the menu
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
