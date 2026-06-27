import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { hrAtomicRanges } from "./hr";
import type { RenderMode } from "./render-mode";

// Rendered-DOM tests for the horizontal-rule divider (M2 S1). happy-dom has no
// CSS/layout, so these assert decoration STRUCTURE (the divider widget present /
// the literal chars kept), not pixels — same contract as markers.dom.test.ts.
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

const lineText = (v: EditorView, n: number) =>
  v.contentDOM.querySelectorAll(".cm-line")[n]?.textContent ?? "";
const count = (v: EditorView, sel: string) => v.contentDOM.querySelectorAll(sel).length;
const atomicTotal = (v: EditorView) => {
  let total = 0;
  for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
  return total;
};

// doc "a\n\n---\n\nb": line 2 is the rule; the dashes start at index 3.
const DOC = "a\n\n---\n\nb";

describe("[REQ-HR-1] Horizontal rule — Clean (Formatted) mode", () => {
  it("replaces the --- run with a divider widget and hides the chars", () => {
    const v = build(DOC, "clean", 0);
    expect(count(v, ".cm-md-hr")).toBe(1);
    expect(lineText(v, 2)).not.toContain("---");
  });

  it("renders *** and ___ rules too", () => {
    expect(count(build("a\n\n***\n\nb", "clean", 0), ".cm-md-hr")).toBe(1);
    expect(count(build("a\n\n___\n\nb", "clean", 0), ".cm-md-hr")).toBe(1);
  });

  it("reveals the literal --- when the caret is on the rule line", () => {
    const v = build(DOC, "clean", 3); // caret within the dashes
    expect(count(v, ".cm-md-hr")).toBe(0);
    expect(lineText(v, 2)).toContain("---");
  });

  it("makes the hidden rule atomic (arrow-skip / single delete)", () => {
    expect(atomicTotal(build(DOC, "clean", 0))).toBeGreaterThan(0);
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
    expect(lineText(v, 2)).toContain("---");
    expect(atomicTotal(v)).toBe(0);
  });

  it("Source mode keeps the literal --- (no widget)", () => {
    const v = build(DOC, "markers-rendered", 0);
    expect(count(v, ".cm-md-hr")).toBe(0);
    expect(lineText(v, 2)).toContain("---");
    expect(atomicTotal(v)).toBe(0);
  });

  it("falls back to an empty atomic set when the hr plugin is absent", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "---", extensions: [hrAtomicRanges] }),
      parent: document.body,
    });
    const fns = view.state.facet(EditorView.atomicRanges);
    expect(fns[fns.length - 1](view).size).toBe(0);
  });
});
