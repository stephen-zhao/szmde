import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import type { RenderMode } from "./render-mode";

// Rendered-DOM tests for nested lists (M2 S6). Nesting itself comes from the
// grammar (recursive BulletList/OrderedList) + the M1 hang-indent; this slice
// verifies mixed ordered/unordered nesting renders, and that unordered bullets
// vary by depth (•/◦/▪) like typical editors.
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

const count = (v: EditorView, sel: string) => v.contentDOM.querySelectorAll(sel).length;
const glyphs = (v: EditorView) =>
  [...v.contentDOM.querySelectorAll(".cm-md-bullet")].map((b) => b.textContent);
const hang = (v: EditorView, i = 0) =>
  v.contentDOM.querySelectorAll(".cm-md-hang-indent")[i]?.textContent ?? "";

describe("[REQ-NEST-1] Nested lists — depth-varied bullets", () => {
  it("cycles unordered bullets by depth: • then ◦ then ▪", () => {
    const v = build("- a\n  - b\n    - c");
    expect(glyphs(v)).toEqual(["•", "◦", "▪"]);
  });

  it("wraps back to • at the fourth level", () => {
    const v = build("- a\n  - b\n    - c\n      - d");
    expect(glyphs(v)).toEqual(["•", "◦", "▪", "•"]);
  });

  it("hang-indents a depth-2 continuation with the matching ◦ glyph", () => {
    const v = build("- a\n  - b\n    cont");
    expect(hang(v)).toBe("  ◦ ");
  });
});

describe("[REQ-NEST-1] Nested lists — mixed ordered / unordered", () => {
  it("renders ordered numbers and nested unordered bullets together", () => {
    const v = build("1. one\n   - a\n   - b\n2. two");
    expect(count(v, ".cm-md-list-number")).toBe(2);
    expect(glyphs(v)).toEqual(["•", "•"]); // both nested one level under an ordered item
  });

  it("keeps each nested ordered list's own numbering as content", () => {
    const v = build("1. a\n2. b\n   1. x\n   2. y");
    expect(count(v, ".cm-md-list-number")).toBe(4);
    expect(count(v, ".cm-md-bullet")).toBe(0);
  });
});
