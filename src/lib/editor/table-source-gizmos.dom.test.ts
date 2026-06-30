import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import type { RenderMode } from "./render-mode";

// DOM tests for the Source / Syntax-mode table edit gizmos (M5 S3c). In the non-Clean
// modes a GFM table is raw pipe text; this plugin overlays "+" insert handles on the
// header pipes (columns) and each table line's edge (rows). happy-dom renders the
// widget decorations + can dispatch their mousedown; hover/opacity is CSS (live-only).
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string, mode: RenderMode, caret = 0): EditorView {
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

const DOC = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |";
const count = (v: EditorView, sel: string) => v.contentDOM.querySelectorAll(sel).length;
const giz = (v: EditorView, sel: string, i = 0) =>
  v.contentDOM.querySelectorAll<HTMLButtonElement>(sel)[i];
const mdown = (el: Element, button = 0) =>
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button }));
const doc = (v: EditorView) => v.state.doc.toString();

describe("[REQ-TBLED-3] Source/Syntax-mode table insert gizmos", () => {
  it("overlays column handles on the header pipes + row handles on each line", () => {
    const v = build(DOC, "markers-rendered", 0);
    expect(count(v, ".cm-tbl-src-colstart")).toBe(1); // leading pipe → insert at col 0
    expect(count(v, ".cm-tbl-src-col")).toBe(2); // the inner + trailing pipes
    expect(count(v, ".cm-tbl-src-row")).toBe(2); // header + the one body row (delimiter skipped)
  });

  it("also appears in Syntax mode", () => {
    const v = build(DOC, "markers-syntax", 0);
    expect(count(v, ".cm-tbl-src-gizmo")).toBeGreaterThan(0);
  });

  it("does NOT appear in Clean mode (the rendered table carries its own gizmos)", () => {
    const v = build(DOC, "clean", 0);
    expect(count(v, ".cm-tbl-src-gizmo")).toBe(0);
  });

  it("the '+' glyph is CSS-only (the table source text is untouched)", () => {
    const v = build(DOC, "markers-rendered", 0);
    expect(v.contentDOM.textContent).toContain("| a | b |"); // no stray '+' in the pipe text
  });

  it("an inner column handle inserts a column at that boundary", () => {
    const v = build(DOC, "markers-rendered", 0);
    mdown(giz(v, ".cm-tbl-src-col", 0)); // the pipe between a and b → insert at col 1
    expect(doc(v)).toBe("intro\n\n| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |");
  });

  it("the leading-pipe handle inserts a column at the start", () => {
    const v = build(DOC, "markers-rendered", 0);
    mdown(giz(v, ".cm-tbl-src-colstart"));
    expect(doc(v)).toBe("intro\n\n|  | a | b |\n| --- | --- | --- |\n|  | 1 | 2 |");
  });

  it("the header's row handle inserts the first body row", () => {
    const v = build(DOC, "markers-rendered", 0);
    mdown(giz(v, ".cm-tbl-src-row", 0)); // header line edge → body row 0
    expect(doc(v)).toBe("intro\n\n| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |");
  });

  it("a body row's handle inserts a row below it", () => {
    const v = build(DOC, "markers-rendered", 0);
    mdown(giz(v, ".cm-tbl-src-row", 1)); // the body line edge → below body row 0
    expect(doc(v)).toBe("intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |");
  });

  it("a non-primary click on a gizmo does not insert", () => {
    const v = build(DOC, "markers-rendered", 0);
    const before = doc(v);
    mdown(giz(v, ".cm-tbl-src-col", 0), 2); // right-click
    expect(doc(v)).toBe(before);
  });

  it("re-resolves the table after a prior edit shifted it (insert stays correct)", () => {
    const v = build(DOC, "markers-rendered", 0);
    // Prepend text to the intro line so every table offset shifts right.
    v.dispatch({ changes: { from: 0, insert: "XYZ " } });
    forceParsing(v, v.state.doc.length, 5000);
    mdown(giz(v, ".cm-tbl-src-colstart"));
    expect(doc(v)).toBe("XYZ intro\n\n|  | a | b |\n| --- | --- | --- |\n|  | 1 | 2 |");
  });
});
