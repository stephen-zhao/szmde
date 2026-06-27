import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  convertIndentation,
  indentConfigOf,
  indentExtension,
  indentUnitString,
  type IndentConfig,
} from "./indent";

describe("indentUnitString", () => {
  it("spaces width 2", () => expect(indentUnitString({ style: "spaces", width: 2 })).toBe("  "));
  it("spaces width 4", () => expect(indentUnitString({ style: "spaces", width: 4 })).toBe("    "));
  it("tab", () => expect(indentUnitString({ style: "tab", width: 4 })).toBe("\t"));
});

describe("indentConfigOf", () => {
  const cfg = (c: IndentConfig) => indentConfigOf(EditorState.create({ extensions: indentExtension(c) }));
  it("reads spaces 2", () => expect(cfg({ style: "spaces", width: 2 })).toEqual({ style: "spaces", width: 2 }));
  it("reads spaces 4", () => expect(cfg({ style: "spaces", width: 4 })).toEqual({ style: "spaces", width: 4 }));
  it("reads tab", () => expect(cfg({ style: "tab", width: 4 })).toEqual({ style: "tab", width: 4 }));
});

describe("convertIndentation", () => {
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
});
