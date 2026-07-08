import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { setEmoji } from "./emoji";
import type { RenderMode } from "./render-mode";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string, opts: { mode?: RenderMode; caret?: number; emoji?: boolean } = {}): EditorView {
  const { mode = "clean", caret = 0, emoji = true } = opts;
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: editorExtensions(true, mode, { style: "spaces", width: 2 }, emoji),
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

describe("[REQ-EMOJI-1] emoji shortcodes — rendered DOM", () => {
  it("renders a known shortcode as the glyph in Clean mode", () => {
    const v = build("ship it :rocket:", { caret: 0 });
    expect(count(v, ".cm-md-emoji")).toBe(1);
    expect(lineText(v, 0)).toContain("🚀");
    expect(lineText(v, 0)).not.toContain(":rocket:");
  });

  it("reveals the literal shortcode when the caret is on it", () => {
    const v = build("x :rocket:", { caret: 5 }); // caret inside :rocket:
    expect(count(v, ".cm-md-emoji")).toBe(0);
    expect(lineText(v, 0)).toContain(":rocket:");
  });

  it("leaves an unknown shortcode literal", () => {
    const v = build("hi :notarealemojiname:", { caret: 0 });
    expect(count(v, ".cm-md-emoji")).toBe(0);
    expect(lineText(v, 0)).toContain(":notarealemojiname:");
  });

  it("leaves a shortcode inside inline code literal", () => {
    const v = build("`:rocket:`", { caret: 0 });
    expect(count(v, ".cm-md-emoji")).toBe(0);
    expect(lineText(v, 0)).toContain(":rocket:");
  });

  it("leaves a shortcode inside a fenced code block literal", () => {
    const v = build("```\n:rocket:\n```", { caret: 0 });
    expect(count(v, ".cm-md-emoji")).toBe(0);
  });

  it("leaves a shortcode inside verbatim raw HTML literal (SPEC §5.2)", () => {
    // Genuinely-verbatim HTML: a block, a comment, and an attribute value. (An
    // inline `<b>:rocket:</b>` is NOT verbatim — its content is normal markdown,
    // so the emoji SHOULD render there, matching CommonMark/GitHub.)
    expect(count(build("<div>\n:rocket:\n</div>", { caret: 0 }), ".cm-md-emoji")).toBe(0); // HTML block
    expect(count(build("<!-- :rocket: -->", { caret: 0 }), ".cm-md-emoji")).toBe(0); // comment
    expect(count(build('<a href="x" title=":rocket:">k</a>', { caret: 0 }), ".cm-md-emoji")).toBe(0); // attribute
  });

  it("does not render in Source mode (literal stays)", () => {
    const v = build(":rocket:", { mode: "markers-rendered", caret: 0 });
    expect(count(v, ".cm-md-emoji")).toBe(0);
    expect(lineText(v, 0)).toContain(":rocket:");
  });

  it("does not render in Syntax mode", () => {
    const v = build(":rocket:", { mode: "markers-syntax", caret: 0 });
    expect(count(v, ".cm-md-emoji")).toBe(0);
  });

  it("renders nothing when emoji is disabled", () => {
    const v = build(":rocket:", { emoji: false, caret: 0 });
    expect(count(v, ".cm-md-emoji")).toBe(0);
    expect(lineText(v, 0)).toContain(":rocket:");
  });

  it("makes the rendered emoji atomic (arrow-skip / single delete)", () => {
    const v = build("a :rocket: b", { caret: 0 });
    let total = 0;
    for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
    expect(total).toBeGreaterThan(0);
  });

  it("setEmoji toggles rendering live without a rebuild", () => {
    const v = build("a :rocket:", { caret: 0 });
    expect(count(v, ".cm-md-emoji")).toBe(1);
    setEmoji(v, false);
    expect(count(v, ".cm-md-emoji")).toBe(0);
    setEmoji(v, true);
    expect(count(v, ".cm-md-emoji")).toBe(1);
  });

  it("reuses the emoji widget DOM across an unrelated edit (eq)", () => {
    const v = build("z :rocket:", { caret: 0 });
    const before = v.contentDOM.querySelector(".cm-md-emoji");
    expect(before?.textContent).toBe("🚀");
    v.dispatch({ changes: { from: 0, insert: "Z" }, selection: EditorSelection.cursor(0) });
    forceParsing(v, v.state.doc.length, 5000);
    const after = v.contentDOM.querySelector(".cm-md-emoji");
    expect(after).toBe(before); // same instance → eq returned true, DOM reused
  });
});
