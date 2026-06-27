import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { alertAtomicRanges } from "./alerts";
import type { RenderMode } from "./render-mode";

// Rendered-DOM tests for GFM alerts/callouts (M2 S4). Alerts are NOT a grammar
// node — `> [!NOTE]` is a plain Blockquote whose first line is `[!TYPE]`, so we
// detect them. The callout box (line classes) shows in every mode; the `[!TYPE]`
// label becomes an icon+name widget only in Clean (reveal-on-cursor).
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

// caret on line 1 (the body) so the title line's label is rendered, not revealed.
const TYPES: [string, string][] = [
  ["NOTE", "Note"],
  ["TIP", "Tip"],
  ["IMPORTANT", "Important"],
  ["WARNING", "Warning"],
  ["CAUTION", "Caution"],
];

describe("[REQ-ALERT-1] GFM alerts — callout box + label per type", () => {
  it.each(TYPES)("renders [!%s] as a %s callout with box + icon/name", (type, name) => {
    const doc = `> [!${type}]\n> body`;
    const v = build(doc, "clean", doc.length); // caret at end (body line)
    expect(count(v, `.cm-alert-${type.toLowerCase()}`)).toBeGreaterThanOrEqual(2); // both lines boxed
    expect(count(v, ".cm-alert-label")).toBe(1);
    const title = lineText(v, 0);
    expect(title).toContain(name);
    expect(title).not.toContain(`[!${type}]`);
  });

  it("matches the type case-insensitively", () => {
    const v = build("> [!warning]\n> careful", "clean", 20);
    expect(count(v, ".cm-alert-warning")).toBeGreaterThanOrEqual(2);
    expect(lineText(v, 0)).toContain("Warning");
  });
});

describe("[REQ-ALERT-2] GFM alerts — reveal, modes, and non-alerts", () => {
  it("reveals the literal [!NOTE] when the caret is on the title line", () => {
    const v = build("> [!NOTE]\n> body", "clean", 2); // caret on the title line
    expect(count(v, ".cm-alert-label")).toBe(0);
    expect(lineText(v, 0)).toContain("[!NOTE]");
    // box still present even while editing the marker
    expect(count(v, ".cm-alert-note")).toBeGreaterThanOrEqual(2);
  });

  it("shows the callout box in Source mode but keeps the literal [!NOTE]", () => {
    const v = build("> [!NOTE]\n> body", "markers-rendered", 0);
    expect(count(v, ".cm-alert-note")).toBeGreaterThanOrEqual(2);
    expect(count(v, ".cm-alert-label")).toBe(0);
    expect(lineText(v, 0)).toContain("[!NOTE]");
  });

  it("leaves a normal blockquote unstyled as an alert", () => {
    const v = build("> just a quote\n> more", "clean", 18);
    expect(count(v, "[class*='cm-alert']")).toBe(0);
    expect(count(v, ".cm-blockquote")).toBeGreaterThanOrEqual(2);
  });

  it("does not treat `[!BOGUS]` as an alert", () => {
    const v = build("> [!BOGUS]\n> body", "clean", 13);
    expect(count(v, "[class*='cm-alert']")).toBe(0);
    expect(count(v, ".cm-blockquote")).toBeGreaterThanOrEqual(2);
  });

  it("reveals the literal [!TYPE] for editing when the label is clicked", () => {
    const v = build("> [!NOTE]\n> body", "clean", 16); // caret on body → label rendered
    const label = v.contentDOM.querySelector(".cm-alert-label")!;
    label.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(v.state.selection.main.head).toBe(2); // caret at the `[` of `[!NOTE]`
    expect(count(v, ".cm-alert-label")).toBe(0); // revealed to literal text
  });

  it("reuses the alert-label DOM across an edit elsewhere (AlertLabelWidget.eq)", () => {
    const v = build("> [!NOTE]\n> body", "clean", 16); // caret on the body line (end)
    const before = v.contentDOM.querySelector(".cm-alert-label");
    expect(before).not.toBeNull();
    const end = v.state.doc.length;
    v.dispatch({ changes: { from: end, insert: "!" }, selection: EditorSelection.cursor(end + 1) });
    forceParsing(v, v.state.doc.length, 5000);
    expect(v.contentDOM.querySelector(".cm-alert-label")).toBe(before);
  });

  it("falls back to an empty atomic set when the alert plugin is absent", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "> [!NOTE]\n> x", extensions: [alertAtomicRanges] }),
      parent: document.body,
    });
    const fns = view.state.facet(EditorView.atomicRanges);
    expect(fns[fns.length - 1](view).size).toBe(0);
  });
});
