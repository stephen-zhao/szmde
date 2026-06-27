import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
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
});
