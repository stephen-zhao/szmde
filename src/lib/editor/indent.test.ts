import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import {
  convertIndentation,
  indentConfigOf,
  indentExtension,
  indentUnitString,
  setIndent,
  type IndentConfig,
} from "./indent";
import { editorExtensions } from "./setup";

describe("[REQ-INDENT-1] indentUnitString", () => {
  it("spaces width 2", () => expect(indentUnitString({ style: "spaces", width: 2 })).toBe("  "));
  it("spaces width 4", () => expect(indentUnitString({ style: "spaces", width: 4 })).toBe("    "));
  it("tab", () => expect(indentUnitString({ style: "tab", width: 4 })).toBe("\t"));
});

describe("[REQ-INDENT-1] indentConfigOf", () => {
  const cfg = (c: IndentConfig) => indentConfigOf(EditorState.create({ extensions: indentExtension(c) }));
  it("reads spaces 2", () => expect(cfg({ style: "spaces", width: 2 })).toEqual({ style: "spaces", width: 2 }));
  it("reads spaces 4", () => expect(cfg({ style: "spaces", width: 4 })).toEqual({ style: "spaces", width: 4 }));
  it("reads tab", () => expect(cfg({ style: "tab", width: 4 })).toEqual({ style: "tab", width: 4 }));

  it("reads the CodeMirror default (2 spaces) when no indent extension is present", () => {
    // No indentExtension at all → the indentUnit facet's own default applies;
    // indentConfigOf must still classify it as 2-space soft indentation.
    const c = indentConfigOf(EditorState.create({ doc: "x" }));
    expect(c).toEqual({ style: "spaces", width: 2 });
  });
});

describe("[REQ-INDENT-1] indentUnitString — width clamp", () => {
  it("clamps a sub-1 width to a single space (never zero spaces)", () => {
    expect(indentUnitString({ style: "spaces", width: 0 })).toBe(" ");
    expect(indentUnitString({ style: "spaces", width: -3 })).toBe(" ");
  });
});

describe("[REQ-INDENT-1] setIndent — live reconfigure", () => {
  let view: EditorView | undefined;
  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("reconfigures the indent compartment so indentConfigOf reflects the new value", () => {
    view = new EditorView({
      state: EditorState.create({ extensions: [indentExtension({ style: "spaces", width: 2 })] }),
      parent: document.body,
    });
    expect(indentConfigOf(view.state)).toEqual({ style: "spaces", width: 2 });
    setIndent(view, { style: "tab", width: 4 });
    // The state actually changed (new value visible) and tab size came along.
    expect(indentConfigOf(view.state)).toEqual({ style: "tab", width: 4 });
    expect(view.state.tabSize).toBe(4);
  });
});

describe("[REQ-INDENT-2] convertIndentation", () => {
  let view: EditorView | undefined;
  afterEach(() => {
    view?.destroy();
    view = undefined;
  });
  function viewWith(doc: string, c: IndentConfig) {
    view = new EditorView({
      state: EditorState.create({ doc, extensions: [indentExtension(c)] }),
      parent: document.body,
    });
    return view;
  }

  it("converts spaces to tabs preserving visual width", () => {
    const v = viewWith("    x\n  y", { style: "tab", width: 2 });
    convertIndentation(v);
    expect(v.state.doc.toString()).toBe("\t\tx\n\ty");
  });

  it("converts tabs to spaces", () => {
    const v = viewWith("\tx", { style: "spaces", width: 4 });
    convertIndentation(v);
    expect(v.state.doc.toString()).toBe("    x");
  });

  it("leaves already-correct indentation unchanged (no-op)", () => {
    const v = viewWith("  a\n    b", { style: "spaces", width: 2 });
    convertIndentation(v);
    expect(v.state.doc.toString()).toBe("  a\n    b");
  });

  it("leaves a non-indented line untouched while converting indented ones", () => {
    // "b" has no leading whitespace → the regex misses → that line is skipped;
    // only the indented "  a" is rewritten.
    const v = viewWith("  a\nb", { style: "tab", width: 2 });
    convertIndentation(v);
    expect(v.state.doc.toString()).toBe("\ta\nb");
  });

  it("skips fenced-code interiors while converting surrounding lines", () => {
    // Needs the real markdown parser so syntaxTree yields FencedCode nodes; the
    // bare indentExtension has no parser. The indented line OUTSIDE the fence
    // becomes a tab; the indented line INSIDE the fence is preserved verbatim —
    // its spaces are significant code, not editor indentation.
    const text = "  before\n```\n    code\n```\n  after";
    view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: editorExtensions(true, "clean", { style: "tab", width: 2 }),
      }),
      parent: document.body,
    });
    forceParsing(view, text.length, 5000);
    convertIndentation(view);
    expect(view.state.doc.toString()).toBe("\tbefore\n```\n    code\n```\n\tafter");
  });
});
