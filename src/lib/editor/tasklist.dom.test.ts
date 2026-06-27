import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { taskAtomicRanges } from "./tasks";
import type { RenderMode } from "./render-mode";

// Rendered-DOM tests for GFM task lists (M2 S2). Clean mode replaces `- [ ]` /
// `- [x]` with a real checkbox; clicking it toggles the on-disk char. happy-dom
// gives us a working <input>.checked + .click(), so the toggle is exercised end
// to end (document text changes), unlike the pixel-level styling.
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
const boxes = (v: EditorView) =>
  [...v.contentDOM.querySelectorAll<HTMLInputElement>("input.cm-md-task")];

describe("[REQ-TASK-1] Task lists — Clean (Formatted) mode", () => {
  it("renders a checkbox per task item and reflects checked state", () => {
    const v = build("- [ ] todo\n- [x] done");
    const cb = boxes(v);
    expect(cb.length).toBe(2);
    expect(cb[0].checked).toBe(false);
    expect(cb[1].checked).toBe(true);
  });

  it("hides the `- [ ]` prefix and draws no • bullet for task items", () => {
    const v = build("- [ ] todo");
    expect(count(v, ".cm-md-bullet")).toBe(0);
    const text = lineText(v, 0);
    expect(text).toContain("todo");
    expect(text).not.toContain("[ ]");
    expect(text).not.toContain("- ");
  });

  it("still draws a • bullet for a normal (non-task) sibling item", () => {
    const v = build("- [ ] task\n- plain");
    expect(count(v, "input.cm-md-task")).toBe(1);
    expect(count(v, ".cm-md-bullet")).toBe(1);
  });

  it("renders checkboxes for nested task items", () => {
    const v = build("- [ ] a\n  - [x] b");
    const cb = boxes(v);
    expect(cb.length).toBe(2);
    expect(cb[1].checked).toBe(true);
  });
});

describe("[REQ-TASK-2] Task lists — click toggles the on-disk char", () => {
  it("checks an unchecked box: `[ ]` → `[x]`", () => {
    const v = build("- [ ] todo");
    boxes(v)[0].click();
    forceParsing(v, v.state.doc.length, 5000);
    expect(v.state.doc.toString()).toBe("- [x] todo");
  });

  it("unchecks a checked box: `[x]` → `[ ]`", () => {
    const v = build("- [x] done");
    boxes(v)[0].click();
    forceParsing(v, v.state.doc.length, 5000);
    expect(v.state.doc.toString()).toBe("- [ ] done");
  });

  it("toggles only the clicked item among several", () => {
    const v = build("- [ ] a\n- [ ] b\n- [ ] c");
    boxes(v)[1].click();
    forceParsing(v, v.state.doc.length, 5000);
    expect(v.state.doc.toString()).toBe("- [ ] a\n- [x] b\n- [ ] c");
  });

  it("prevents default on mousedown so the click doesn't move the caret first", () => {
    const v = build("- [ ] todo");
    const ev = new Event("mousedown", { bubbles: true, cancelable: true });
    boxes(v)[0].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("[REQ-TASK-1] Task lists — Source / Syntax modes", () => {
  it("Source mode keeps the literal `[ ]` (no checkbox)", () => {
    const v = build("- [ ] todo", "markers-rendered");
    expect(count(v, "input.cm-md-task")).toBe(0);
    expect(lineText(v, 0)).toContain("[ ]");
  });

  it("Syntax mode greys the marker but keeps `[ ]` in the text", () => {
    const v = build("- [ ] todo", "markers-syntax");
    expect(count(v, "input.cm-md-task")).toBe(0);
    expect(lineText(v, 0)).toContain("[ ]");
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
  });

  it("falls back to an empty atomic set when the task plugin is absent", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "- [ ] x", extensions: [taskAtomicRanges] }),
      parent: document.body,
    });
    const fns = view.state.facet(EditorView.atomicRanges);
    expect(fns[fns.length - 1](view).size).toBe(0);
  });
});
