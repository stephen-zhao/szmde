import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";

// Build a real EditorView with the full editor extension set, force the markdown
// parse (so list/heading context exists), and expose key-dispatch helpers. These
// tests exercise the INTEGRATED keymap (precedence and all), which is where the
// behavior keeps regressing — not commands in isolation.
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function make(doc: string, anchor: number, head = anchor): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: editorExtensions(),
  });
  const v = new EditorView({ state, parent: document.body });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}

function press(
  v: EditorView,
  key: string,
  mods: { shift?: boolean; ctrl?: boolean; meta?: boolean } = {},
) {
  v.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      shiftKey: !!mods.shift,
      ctrlKey: !!mods.ctrl,
      metaKey: !!mods.meta,
      bubbles: true,
      cancelable: true,
    }),
  );
}
const doc = (v: EditorView) => v.state.doc.toString();

describe("[REQ-LIST-1][REQ-LIST-2] Enter — list/quote continuation", () => {
  it("Enter in an unordered list adds a new bullet", () => {
    const v = make("- item", 6);
    press(v, "Enter");
    expect(doc(v)).toBe("- item\n- ");
  });

  it("Enter in an ordered list increments the number", () => {
    const v = make("1. item", 7);
    press(v, "Enter");
    expect(doc(v)).toBe("1. item\n2. ");
  });

  it("Enter on an empty top-level list item exits the list", () => {
    const v = make("- item\n- ", 9);
    press(v, "Enter");
    expect(doc(v)).toBe("- item\n");
  });

  it("Enter on a 2x-indented empty list item outdents one level", () => {
    const v = make("- a\n  - b\n    - ", 16);
    press(v, "Enter");
    expect(doc(v)).toBe("- a\n  - b\n  - ");
  });

  it("Enter on a 1x-indented empty list item outdents to top level", () => {
    const v = make("- a\n  - ", 8);
    press(v, "Enter");
    expect(doc(v)).toBe("- a\n- ");
  });

  it("Enter on a 2x empty item with a sibling above outdents one level", () => {
    // The realistic way a nested list is built: a nested item, then an empty
    // sibling beneath it at the same (2x) level.
    const v = make("- a\n  - b\n    - c\n    - ", 23);
    press(v, "Enter");
    expect(doc(v)).toBe("- a\n  - b\n    - c\n  - ");
  });

  it("Enter on a 2x empty item directly under a top item (level gap) outdents", () => {
    const v = make("- a\n    - ", 10);
    press(v, "Enter");
    expect(doc(v)).toBe("- a\n  - ");
  });

  it("Enter in a plain paragraph just inserts a newline", () => {
    const v = make("hello", 5);
    press(v, "Enter");
    expect(doc(v)).toBe("hello\n");
  });

  it("Shift+Enter in a list does NOT add a new bullet", () => {
    const v = make("- item", 6);
    press(v, "Enter", { shift: true });
    expect(doc(v)).not.toBe("- item\n- ");
    expect(doc(v).startsWith("- item\n")).toBe(true);
  });
});

describe("[REQ-LIST-3] Enter — multi-line list items (continuation lines)", () => {
  // Repro: type "- one", Shift-Enter (soft break, no marker), type "two", then
  // Enter. The caret sits on a CONTINUATION line that the parser folds into the
  // ListItem (it doesn't start with a marker). Enter must still open a new bullet.
  it("Enter on a bullet's continuation line opens a new bullet", () => {
    const v = make("- one\ntwo", 9); // caret at end of the continuation line
    press(v, "Enter");
    expect(doc(v)).toBe("- one\ntwo\n- ");
  });

  it("Enter on an ordered item's continuation line continues the numbering", () => {
    const v = make("1. one\ntwo", 10);
    press(v, "Enter");
    expect(doc(v)).toBe("1. one\ntwo\n2. ");
  });

  it("Enter mid-continuation-line splits into a new bullet", () => {
    const v = make("- one\ntwo", 8); // caret after "tw", before the final "o"
    press(v, "Enter");
    expect(doc(v)).toBe("- one\ntw\n- o");
  });

  it("Enter on a nested bullet's continuation line adds a sibling at that level", () => {
    const v = make("- a\n  - b\n  cont", 16); // caret at end of the nested continuation
    press(v, "Enter");
    expect(doc(v)).toBe("- a\n  - b\n  cont\n  - ");
  });

  it("Enter on a properly-indented continuation line still opens a new bullet", () => {
    const v = make("- one\n  two", 11); // continuation hang-indented under the content
    press(v, "Enter");
    expect(doc(v)).toBe("- one\n  two\n- ");
  });
});

describe("[REQ-LIST-5] Shift+Enter — soft break hangs under list content", () => {
  // A soft break inside a list item should align the new line under the item's
  // CONTENT (past the marker), not drop to column 0.
  it("hangs a bullet continuation under the text (2-space marker)", () => {
    const v = make("- one", 5);
    press(v, "Enter", { shift: true });
    expect(doc(v)).toBe("- one\n  ");
    expect(v.state.selection.main.head).toBe(8);
  });

  it("hangs an ordered continuation under the text (3-space marker)", () => {
    const v = make("1. one", 6);
    press(v, "Enter", { shift: true });
    expect(doc(v)).toBe("1. one\n   ");
  });

  it("hangs a nested bullet continuation under the nested text", () => {
    const v = make("- a\n  - b", 9); // caret at end of "  - b"
    press(v, "Enter", { shift: true });
    expect(doc(v)).toBe("- a\n  - b\n    ");
  });

  it("keeps the same hang indent on a repeated soft break", () => {
    const v = make("- one\n  two", 11);
    press(v, "Enter", { shift: true });
    expect(doc(v)).toBe("- one\n  two\n  ");
  });

  it("does not indent a soft break outside any list", () => {
    const v = make("hello", 5);
    press(v, "Enter", { shift: true });
    expect(doc(v)).toBe("hello\n");
  });
});

describe("[REQ-LIST-4][REQ-INDENT-1] Tab — soft tab vs list nesting", () => {
  it("Tab on an empty list item nests it instead of inserting spaces", () => {
    const v = make("- ", 2);
    press(v, "Tab");
    expect(doc(v)).toBe("  - ");
  });

  it("Tab on a plain line inserts 2 spaces", () => {
    const v = make("hi", 2);
    press(v, "Tab");
    expect(doc(v)).toBe("hi  ");
  });

  it("Tab inserts a tab character when the indent style is Tab", () => {
    view = new EditorView({
      state: EditorState.create({
        doc: "x",
        selection: EditorSelection.cursor(1),
        extensions: editorExtensions(true, "clean", { style: "tab", width: 4 }),
      }),
      parent: document.body,
    });
    forceParsing(view, 1, 5000);
    press(view, "Tab");
    expect(doc(view)).toBe("x\t");
  });
});

describe("[REQ-FORMAT-1][REQ-FORMAT-2] Ctrl/Cmd+B / +I — toggle emphasis", () => {
  it("Ctrl+B wraps the word at the cursor in **", () => {
    const v = make("hello world", 8); // cursor inside "world"
    press(v, "b", { ctrl: true });
    expect(doc(v)).toBe("hello **world**");
  });

  it("Ctrl+B again unwraps it", () => {
    const v = make("hello **world**", 10); // cursor inside the bold word
    press(v, "b", { ctrl: true });
    expect(doc(v)).toBe("hello world");
  });

  it("Ctrl+I wraps the word at the cursor in *", () => {
    const v = make("hello world", 8);
    press(v, "i", { ctrl: true });
    expect(doc(v)).toBe("hello *world*");
  });

  it("Ctrl+B is inert inside inline code (the inCode guard)", () => {
    // Caret between the backticks, inside `code`. inCode() walks the tree, finds
    // InlineCode, and bails — the document must be left exactly as-is.
    const v = make("a `code` b", 5); // cursor inside the inline-code span
    press(v, "b", { ctrl: true });
    expect(doc(v)).toBe("a `code` b");
  });

  it("Ctrl+I is inert inside a fenced code block", () => {
    const v = make("```\nlet x\n```", 8); // cursor inside the fenced code body
    press(v, "i", { ctrl: true });
    expect(doc(v)).toBe("```\nlet x\n```");
  });

  it("Ctrl+B does nothing when the cursor isn't on a word (nothing to wrap)", () => {
    // Empty selection sitting on whitespace: wordAt() returns null, so the
    // command finds nothing to wrap and leaves the document untouched.
    const v = make("hi   there", 3); // cursor in the run of spaces
    press(v, "b", { ctrl: true });
    expect(doc(v)).toBe("hi   there");
  });
});

describe("[REQ-FORMAT-1][REQ-LIST-4] Keymap guard fallbacks (non-list / in-code paths)", () => {
  it("Tab with a non-empty selection indents the line(s) (indentMore)", () => {
    const v = make("hi", 0, 2); // "hi" selected
    press(v, "Tab");
    expect(doc(v)).toBe("  hi");
  });

  it("Tab inside a fenced code block inserts spaces, not list nesting", () => {
    const v = make("```\ncode\n```", 8); // end of the code line, inside the fence
    press(v, "Tab");
    expect(doc(v)).toBe("```\ncode  \n```");
  });

  it("Enter inside a fenced code block does not continue a list", () => {
    // "- x" inside a fence is literal code; the inCode guard must skip list logic.
    const v = make("```\n- x\n```", 7); // end of the "- x" line, inside the fence
    const before = doc(v).length;
    press(v, "Enter");
    expect(doc(v)).not.toContain("- x\n- "); // no bullet continuation
    expect(doc(v).length).toBeGreaterThan(before); // a line break was inserted
  });

  it("Shift+Enter inside a fenced code block does not hang-indent", () => {
    const v = make("```\n- x\n```", 7);
    press(v, "Enter", { shift: true });
    expect(doc(v)).not.toContain("- x\n  "); // no list hang-indent inside code
    expect(doc(v).startsWith("```\n- x\n")).toBe(true);
  });
});
