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

describe("Enter — list/quote continuation", () => {
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

describe("Tab — soft tab vs list nesting", () => {
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
});

describe("Ctrl/Cmd+B / +I — toggle emphasis", () => {
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
});
