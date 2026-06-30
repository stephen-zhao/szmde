import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { replaceTable } from "./table-ops";
import { editCellAt, cancelCellEditor, isCellEditing } from "./table-cell-editor";
import { moveCol, insertCol } from "./table-model";

// replaceTable applies a structural op as a whole-table replace, FIRST committing any
// open inline cell editor + re-parsing from the live doc — so a mid-edit edit isn't
// lost and the op never lands on stale offsets (the adversarial-review data-loss fix).
let view: EditorView | undefined;
afterEach(() => {
  cancelCellEditor();
  view?.destroy();
  view = undefined;
});

const DOC = "intro\n\n| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |";
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
const tf = (v: EditorView) => docOf(v).indexOf("| a |"); // a stable position in the table

describe("[REQ-TBLED-3][REQ-TBLED-7] replaceTable", () => {
  it("applies a structural op (column move) as a whole-table replace", () => {
    const v = build(DOC);
    expect(replaceTable(v, tf(v), (m) => moveCol(m, 0, 2))).toBe(true);
    expect(docOf(v)).toBe("intro\n\n| b | c | a |\n| --- | --- | --- |\n| 2 | 3 | 1 |");
  });

  it("returns false (no dispatch) for a no-op op", () => {
    const v = build(DOC);
    expect(replaceTable(v, tf(v), (m) => moveCol(m, 0, 99))).toBe(false); // out of range
    expect(docOf(v)).toBe(DOC);
  });

  it("returns false when the anchor isn't in a table", () => {
    const v = build(DOC);
    expect(replaceTable(v, 0, (m) => moveCol(m, 0, 1))).toBe(false); // pos 0 = 'intro'
  });

  it("commits an open cell editor FIRST, then applies the op (no edit loss, no stale write)", () => {
    const v = build(DOC);
    editCellAt(v, tf(v), 0, 0); // edit body cell "1"
    v.contentDOM.querySelector<HTMLTextAreaElement>("textarea.cm-md-cell-editor")!.value = "99";
    // A structural op fires while still editing the cell:
    replaceTable(v, tf(v), (m) => insertCol(m, 1));
    expect(isCellEditing()).toBe(false); // editor was flushed
    // The "99" edit is PRESERVED and the new column is inserted:
    expect(docOf(v)).toBe(
      "intro\n\n| a |  | b | c |\n| --- | --- | --- | --- |\n| 99 |  | 2 | 3 |",
    );
  });
});
