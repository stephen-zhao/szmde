import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { renderInlineMarkdown } from "./tables";
import type { RenderMode } from "./render-mode";

// Rendered-DOM tests for GFM tables (M2 S5, render-only). Clean mode replaces the
// pipe-table source with a real <table> (block widget); the caret entering the
// table reveals the raw source for editing (the rich structured editing is the
// deferred §7.4 effort). happy-dom builds a real <table> we can walk.
let view: EditorView | undefined;
afterEach(() => {
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
