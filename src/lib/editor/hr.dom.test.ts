import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import type { RenderMode } from "./render-mode";

// Rendered-DOM tests for the horizontal-rule divider (M2 S1). The divider is a
// BLOCK widget (so a click anywhere on the line hits it), which replaces the
// line's `.cm-line`, so we assert on whole-content text rather than per-line.
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
const atomicTotal = (v: EditorView) => {
  let total = 0;
  for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
  return total;
};

// doc "a\n\n---\n\nb": the rule line is the dashes at [3,6).
const DOC = "a\n\n---\n\nb";

describe("[REQ-HR-1] Horizontal rule — Clean (Formatted) mode", () => {
  it("replaces the --- run with a divider widget and hides the chars", () => {
    const v = build(DOC, "clean", 0);
    expect(count(v, ".cm-md-hr")).toBe(1);
    expect(text(v)).not.toContain("---");
  });

  it("renders *** and ___ rules too", () => {
    expect(count(build("a\n\n***\n\nb", "clean", 0), ".cm-md-hr")).toBe(1);
    expect(count(build("a\n\n___\n\nb", "clean", 0), ".cm-md-hr")).toBe(1);
  });

  it("reveals the literal --- when the caret is on the rule line", () => {
    const v = build(DOC, "clean", 3); // caret on the rule line
    expect(count(v, ".cm-md-hr")).toBe(0);
    expect(text(v)).toContain("---");
  });

  it("makes the hidden rule atomic (arrow-skip / single delete)", () => {
    expect(atomicTotal(build(DOC, "clean", 0))).toBeGreaterThan(0);
  });

  it("clicking the divider places the caret at the END of the rule line", () => {
    const v = build(DOC, "clean", 0); // HR rendered (caret on line 0)
    const hr = v.contentDOM.querySelector(".cm-md-hr")!;
    hr.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(v.state.selection.main.head).toBe(6); // end of the `---` line, never the start
  });

  it("reuses the divider DOM across an edit after it (HrWidget.eq)", () => {
    const v = build(DOC, "clean", 0);
    const before = v.contentDOM.querySelector(".cm-md-hr");
    expect(before).not.toBeNull();
    const end = v.state.doc.length;
    v.dispatch({ changes: { from: end, insert: "!" }, selection: EditorSelection.cursor(end + 1) });
    forceParsing(v, v.state.doc.length, 5000);
    expect(v.contentDOM.querySelector(".cm-md-hr")).toBe(before); // same `to` → eq true → reused
  });

  it("does NOT treat a top-of-document frontmatter --- as a rule", () => {
    const v = build("---\ntitle: x\n---\n\nbody", "clean", 20);
    expect(count(v, ".cm-md-hr")).toBe(0);
  });
});

describe("[REQ-HR-1] Horizontal rule — Syntax / Source modes", () => {
  it("Syntax mode greys the --- chars but keeps them in the text", () => {
    const v = build(DOC, "markers-syntax", 0);
    expect(count(v, ".cm-md-hr")).toBe(0);
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
    expect(text(v)).toContain("---");
    expect(atomicTotal(v)).toBe(0);
  });

  it("Source mode keeps the literal --- (no widget)", () => {
    const v = build(DOC, "markers-rendered", 0);
    expect(count(v, ".cm-md-hr")).toBe(0);
    expect(text(v)).toContain("---");
    expect(atomicTotal(v)).toBe(0);
  });
});
