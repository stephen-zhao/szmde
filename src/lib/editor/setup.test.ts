import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions, setGlobalWrap, wrapStateOf } from "./setup";

// These exercise setup.ts's code-block-wrap subsystem and decoration builders on
// REAL EditorViews over fenced-code documents. happy-dom has no layout, but the
// decoration CLASSES and BlockWrapper DOM boxes are emitted regardless, so the
// asserts below catch wrap-state and decoration regressions (a missing close
// line, a box around the wrong lines, a "partial" stuck after toggling back).
//
// Note on per-block overrides: the `setBlockWrap` StateEffect is module-private.
// Its only public trigger is the per-block "wrap"/"no-wrap" toggle widget that
// `blockLineDecorations` renders into each fence header. So we drive overrides by
// CLICKING that widget — which both dispatches the effect and proves the widget
// is wired up. `setGlobalWrap` and `wrapStateOf` are the public read/write API.
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string, codeWrap = true, caret = 0): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: editorExtensions(codeWrap, "clean"),
    }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}

const count = (v: EditorView, sel: string) => v.contentDOM.querySelectorAll(sel).length;

/** Click the per-block wrap toggle of the Nth code block's header. */
function clickToggle(v: EditorView, i = 0) {
  const t = v.contentDOM.querySelectorAll(".cm-cb-wraptoggle")[i] as HTMLElement | undefined;
  if (!t) throw new Error(`no wrap toggle widget at index ${i}`);
  t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

// A standard closed fenced block: open fence, 2 content lines, close fence.
const CLOSED = "```js\nconst x = 1;\nconst y = 2;\n```\n";

describe("codeBlockWrap default + setGlobalWrap", () => {
  it("defaults code blocks to wrap=on (cm-cb-code, wrapping box)", () => {
    const v = build(CLOSED, true);
    expect(wrapStateOf(v.state)).toBe("on");
    // Content lines carry the wrapping class, not the nowrap one.
    expect(count(v, ".cm-cb-code")).toBe(2);
    expect(count(v, ".cm-cb-nowrap")).toBe(0);
    // The box is the wrapping variant.
    expect(count(v, ".cm-cb-box")).toBe(1);
    expect(count(v, ".cm-cb-box-nowrap")).toBe(0);
  });

  it("honors an initial editor-wide default of wrap=off (nowrap box + class)", () => {
    const v = build(CLOSED, false);
    expect(wrapStateOf(v.state)).toBe("off");
    // cm-cb-box-nowrap also carries cm-cb-box, so the box selector still matches.
    expect(count(v, ".cm-cb-box-nowrap")).toBe(1);
    expect(count(v, ".cm-cb-nowrap")).toBe(2);
    expect(count(v, ".cm-cb-code")).toBe(2); // cm-cb-code is on both wrap + nowrap lines
  });

  it("setGlobalWrap flips the editor-wide default and the rendered classes", () => {
    const v = build(CLOSED, true);
    expect(count(v, ".cm-cb-box-nowrap")).toBe(0);

    setGlobalWrap(v, false);
    expect(wrapStateOf(v.state)).toBe("off");
    expect(count(v, ".cm-cb-box-nowrap")).toBe(1);
    expect(count(v, ".cm-cb-nowrap")).toBe(2);

    setGlobalWrap(v, true);
    expect(wrapStateOf(v.state)).toBe("on");
    expect(count(v, ".cm-cb-box-nowrap")).toBe(0);
    expect(count(v, ".cm-cb-nowrap")).toBe(0);
  });

  it("setGlobalWrap clears per-block overrides (no stale 'partial')", () => {
    const v = build(CLOSED, true);
    // Override this block to differ from the default => partial.
    clickToggle(v);
    expect(wrapStateOf(v.state)).toBe("partial");

    // A global set must wipe the override, returning to a uniform state.
    setGlobalWrap(v, true);
    expect(wrapStateOf(v.state)).toBe("on");
    // The block is back on the editor-wide wrapping box.
    expect(count(v, ".cm-cb-box-nowrap")).toBe(0);
    expect(count(v, ".cm-cb-box")).toBe(1);
  });
});

describe("wrapStateOf — tri-state for the menu control", () => {
  it("is 'partial' when a block's override DIFFERS from the default", () => {
    const v = build(CLOSED, true); // default on
    clickToggle(v); // override this block off
    expect(wrapStateOf(v.state)).toBe("partial");
  });

  it("is NOT 'partial' when an override equals the default (redundant override)", () => {
    const v = build(CLOSED, true); // default on
    clickToggle(v); // off -> "partial"
    expect(wrapStateOf(v.state)).toBe("partial");
    clickToggle(v); // back on -> override now EQUALS default, must clear partial
    expect(wrapStateOf(v.state)).toBe("on");
  });
});

describe("per-block setBlockWrap override (via toggle widget)", () => {
  it("flips just one block's box between wrapping and nowrap", () => {
    const v = build(CLOSED, true);
    // Sanity: starts as the wrapping box.
    expect(count(v, ".cm-cb-box")).toBe(1);
    expect(count(v, ".cm-cb-box-nowrap")).toBe(0);

    clickToggle(v); // override this block to no-wrap
    expect(wrapStateOf(v.state)).toBe("partial");
    expect(count(v, ".cm-cb-box-nowrap")).toBe(1);
    // Content lines flip to the nowrap line class too.
    expect(count(v, ".cm-cb-nowrap")).toBe(2);

    clickToggle(v); // back to wrap
    expect(count(v, ".cm-cb-box-nowrap")).toBe(0);
    expect(count(v, ".cm-cb-nowrap")).toBe(0);
  });

  it("overrides only the clicked block, leaving the sibling on the default", () => {
    // Two independent fenced blocks; toggling the first must not touch the second.
    const v = build("```\naaa\n```\n\n```\nbbb\n```\n", true);
    expect(count(v, ".cm-cb-wraptoggle")).toBe(2);
    expect(count(v, ".cm-cb-box")).toBe(2);

    clickToggle(v, 0); // override only the first block to no-wrap
    expect(wrapStateOf(v.state)).toBe("partial");
    // Exactly one block is now the nowrap box; the other stays wrapping.
    expect(count(v, ".cm-cb-box-nowrap")).toBe(1);
    expect(count(v, ".cm-cb-box")).toBe(2); // both still match .cm-cb-box
  });
});

describe("blockLineDecorations — fence/content/frontmatter line classes", () => {
  it("marks open fence, content lines, and close fence on a closed block", () => {
    const v = build(CLOSED, true);
    expect(count(v, ".cm-cb-open")).toBe(1); // first line only
    expect(count(v, ".cm-cb-close")).toBe(1); // closing fence present
    expect(count(v, ".cm-cb-code")).toBe(2); // the two content lines

    // Order matters: open is line 0, close is the last code-block line.
    const lines = Array.from(v.contentDOM.querySelectorAll(".cm-cb-line"));
    expect(lines[0].classList.contains("cm-cb-open")).toBe(true);
    expect(lines[lines.length - 1].classList.contains("cm-cb-close")).toBe(true);
  });

  it("an UNCLOSED block has no close line and its last line stays content", () => {
    // Mid-typing: open fence + content, no closing fence yet.
    const v = build("```js\nconst x = 1;\nconst y = 2;", true);
    expect(count(v, ".cm-cb-open")).toBe(1);
    expect(count(v, ".cm-cb-close")).toBe(0); // critical: nothing is the footer
    // Both lines below the fence are treated as content (incl. the last).
    expect(count(v, ".cm-cb-code")).toBe(2);
  });

  it("places the wrap toggle widget in the header of each fenced block", () => {
    const v = build(CLOSED, true);
    expect(count(v, ".cm-cb-wraptoggle")).toBe(1);
    const toggle = v.contentDOM.querySelector(".cm-cb-wraptoggle");
    // Default wrap=on => the toggle advertises the current state as "wrap".
    expect(toggle?.textContent).toBe("wrap");
    // Lives inside the open-fence line, not a content/close line.
    expect(toggle?.closest(".cm-cb-open")).not.toBeNull();
    expect(toggle?.closest(".cm-cb-code")).toBeNull();
  });

  it("toggle widget label reflects no-wrap when the block is overridden", () => {
    const v = build(CLOSED, true);
    clickToggle(v); // override to no-wrap
    const toggle = v.contentDOM.querySelector(".cm-cb-wraptoggle");
    expect(toggle?.textContent).toBe("no-wrap");
  });

  it("decorates frontmatter, distinguishing fence lines from body lines", () => {
    const v = build("---\ntitle: hi\ntags: a\n---\n\nbody\n");
    // 2 fence lines (---) + 2 body lines all get cm-frontmatter.
    expect(count(v, ".cm-frontmatter")).toBe(4);
    // The two `---` lines additionally get the fence class.
    expect(count(v, ".cm-frontmatter-fence")).toBe(2);
    // The body lines are frontmatter but NOT fences.
    expect(count(v, ".cm-frontmatter:not(.cm-frontmatter-fence)")).toBe(2);
    // Frontmatter is not a code block.
    expect(count(v, ".cm-cb-line")).toBe(0);
  });
});

describe("buildBlockWrappers — content-only scroll box", () => {
  it("boxes the CONTENT lines and leaves both fences outside the box", () => {
    const v = build(CLOSED, true);
    const box = v.contentDOM.querySelector(".cm-cb-box");
    expect(box).not.toBeNull();
    // The box contains exactly the 2 content lines...
    const boxedLines = box!.querySelectorAll(".cm-cb-line");
    expect(boxedLines.length).toBe(2);
    expect(Array.from(boxedLines).every((l) => l.classList.contains("cm-cb-code"))).toBe(true);
    // ...and neither fence: the open and close lines sit OUTSIDE the box.
    expect(box!.querySelector(".cm-cb-open")).toBeNull();
    expect(box!.querySelector(".cm-cb-close")).toBeNull();
  });

  it("emits NO box for a block with no content lines (adjacent fences)", () => {
    // ``` immediately followed by ``` — contentStart > contentEnd, so no box.
    const v = build("```\n```\n", true);
    expect(count(v, ".cm-cb-box")).toBe(0);
    // The fences themselves are still decorated.
    expect(count(v, ".cm-cb-open")).toBe(1);
    expect(count(v, ".cm-cb-close")).toBe(1);
    expect(count(v, ".cm-cb-code")).toBe(0);
  });

  it("boxes the last line of an UNCLOSED block (no fence to exclude)", () => {
    const v = build("```js\nline one\nline two", true);
    const box = v.contentDOM.querySelector(".cm-cb-box");
    expect(box).not.toBeNull();
    // Both content lines are boxed; since there's no closing fence, the last
    // content line is included rather than treated as a footer.
    const boxedLines = box!.querySelectorAll(".cm-cb-line");
    expect(boxedLines.length).toBe(2);
    expect(boxedLines[boxedLines.length - 1].textContent).toBe("line two");
    // No close line exists to leak into (or out of) the box.
    expect(count(v, ".cm-cb-close")).toBe(0);
  });

  it("rebuilds the box as nowrap when the block is overridden", () => {
    const v = build(CLOSED, true);
    expect(v.contentDOM.querySelector(".cm-cb-box-nowrap")).toBeNull();
    clickToggle(v);
    const box = v.contentDOM.querySelector(".cm-cb-box");
    expect(box?.classList.contains("cm-cb-box-nowrap")).toBe(true);
    // Still boxes exactly the content lines after the override.
    expect(box!.querySelectorAll(".cm-cb-line").length).toBe(2);
  });
});
