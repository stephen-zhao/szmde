import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import {
  editCellAt,
  commitCellEditor,
  cancelCellEditor,
  isCellEditing,
  sanitizeCell,
  step,
} from "./table-cell-editor";
import { parseTable } from "./table-model";

// Inline cell editor (REQ-TBLED-7, revised): clicking a cell edits it in place while
// the table stays rendered. The focus/caret plumbing is live-only (v8-ignored); the
// commit/cancel/nav + sanitize + step logic is exercised here in happy-dom.
let view: EditorView | undefined;
afterEach(() => {
  cancelCellEditor(); // drop any editor left open by a test
  view?.destroy();
  view = undefined;
});

const DOC = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |";
function build(doc: string): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
      extensions: editorExtensions(true, "clean"),
    }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}
const docOf = (v: EditorView) => v.state.doc.toString();
const tf = (v: EditorView) => docOf(v).indexOf("| a |"); // a position inside the table
const editor = (v: EditorView) =>
  v.contentDOM.querySelector<HTMLTextAreaElement>("textarea.cm-md-cell-editor");
const key = (ta: HTMLTextAreaElement, k: string, shift = false) =>
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true, cancelable: true }));

describe("[REQ-TBLED-7] sanitizeCell", () => {
  it("escapes bare pipes (no doubling), strips newlines, trims", () => {
    expect(sanitizeCell("a|b")).toBe("a\\|b");
    expect(sanitizeCell("a\\|b")).toBe("a\\|b");
    expect(sanitizeCell("a\nb")).toBe("a b");
    expect(sanitizeCell("  x  ")).toBe("x");
  });
});

describe("[REQ-TBLED-7] step — cell navigation order", () => {
  const m = parseTable("| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |", 0);
  it("next moves right, wrapping header → body 0; null at the last cell", () => {
    expect(step(m, -1, 0, "next")).toEqual({ row: -1, col: 1 });
    expect(step(m, -1, 2, "next")).toEqual({ row: 0, col: 0 });
    expect(step(m, 1, 2, "next")).toBeNull();
  });
  it("prev moves left, wrapping body 0 → header; null at the first cell", () => {
    expect(step(m, 0, 0, "prev")).toEqual({ row: -1, col: 2 });
    expect(step(m, -1, 0, "prev")).toBeNull();
  });
  it("down moves to the row below; null past the last body row", () => {
    expect(step(m, -1, 1, "down")).toEqual({ row: 0, col: 1 });
    expect(step(m, 1, 1, "down")).toBeNull();
  });
});

describe("[REQ-TBLED-7] inline cell editor", () => {
  it("opens on a cell with its source; commit writes it back", () => {
    const v = build(DOC);
    expect(editCellAt(v, tf(v), 0, 0)).toBe(true); // body row 0, col 0 → "1"
    expect(isCellEditing()).toBe(true);
    expect(editor(v)!.value).toBe("1");
    editor(v)!.value = "99";
    commitCellEditor();
    expect(isCellEditing()).toBe(false);
    expect(docOf(v)).toContain("| 99 | 2 |");
  });

  it("Escape cancels without writing", () => {
    const v = build(DOC);
    editCellAt(v, tf(v), 0, 0);
    editor(v)!.value = "zzz";
    key(editor(v)!, "Escape");
    expect(docOf(v)).toContain("| 1 | 2 |"); // unchanged
    expect(isCellEditing()).toBe(false);
  });

  it("Enter commits + moves to the cell below", () => {
    const v = build(DOC);
    editCellAt(v, tf(v), 0, 0); // "1"
    editor(v)!.value = "X";
    key(editor(v)!, "Enter");
    expect(docOf(v)).toContain("| X | 2 |");
    expect(editor(v)?.value).toBe("3"); // now editing the cell below
  });

  it("Tab commits + moves to the next cell; Shift-Tab moves back", () => {
    const v = build(DOC);
    editCellAt(v, tf(v), 0, 0); // "1"
    key(editor(v)!, "Tab");
    expect(editor(v)?.value).toBe("2"); // col 1
    key(editor(v)!, "Tab", true);
    expect(editor(v)?.value).toBe("1"); // back to col 0
  });

  it("blur commits", () => {
    const v = build(DOC);
    editCellAt(v, tf(v), -1, 0); // header "a"
    editor(v)!.value = "AA";
    editor(v)!.dispatchEvent(new Event("blur"));
    expect(docOf(v)).toContain("| AA | b |");
  });

  it("escapes a typed pipe on commit (keeps the table intact)", () => {
    const v = build(DOC);
    editCellAt(v, tf(v), 0, 0);
    editor(v)!.value = "a|b";
    commitCellEditor();
    expect(docOf(v)).toContain("| a\\|b | 2 |");
  });

  it("commit is a no-op when the value is unchanged", () => {
    const v = build(DOC);
    const before = docOf(v);
    editCellAt(v, tf(v), 0, 0);
    commitCellEditor();
    expect(docOf(v)).toBe(before);
  });

  it("returns false for an out-of-range cell, and when not in a table", () => {
    const v = build(DOC);
    expect(editCellAt(v, tf(v), 9, 9)).toBe(false);
    expect(editCellAt(v, 0, 0, 0)).toBe(false); // pos 0 = 'intro', no table
  });

  it("Tab at the last cell commits and closes (no next cell)", () => {
    const v = build("intro\n\n| a |\n| - |\n| z |"); // 1 col, 1 body row
    editCellAt(v, tf(v), 0, 0); // "z"
    key(editor(v)!, "Tab");
    expect(isCellEditing()).toBe(false); // nowhere to go → closed
  });
});
