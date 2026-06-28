import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { SearchQuery, getSearchQuery, replaceAll, setSearchQuery } from "@codemirror/search";
import { editorExtensions } from "./setup";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string): EditorView {
  const v = new EditorView({
    state: EditorState.create({ doc, extensions: editorExtensions(true, "markers-rendered") }),
    parent: document.body,
  });
  view = v;
  return v;
}

function setQuery(v: EditorView, q: ConstructorParameters<typeof SearchQuery>[0]) {
  v.dispatch({ effects: setSearchQuery.of(new SearchQuery(q)) });
}

describe("[REQ-FR-2] find & replace — capture-group replacement", () => {
  it("rewrites a \\1 replacement to $1 when regexp is on", () => {
    const v = build("hello");
    setQuery(v, { search: "(l+)", replace: "[\\1]", regexp: true });
    expect(getSearchQuery(v.state).replace).toBe("[$1]");
  });

  it("leaves the \\1 replacement literal when regexp is OFF (literal mode)", () => {
    const v = build("hello");
    setQuery(v, { search: "ll", replace: "\\1", regexp: false });
    expect(getSearchQuery(v.state).replace).toBe("\\1"); // literal, not a group ref
  });

  it("end-to-end: replaceAll substitutes the captured group via \\1", () => {
    const v = build("2026-06-28");
    setQuery(v, { search: "(\\d{4})-(\\d{2})-(\\d{2})", replace: "\\3/\\2/\\1", regexp: true });
    replaceAll(v);
    expect(v.state.doc.toString()).toBe("28/06/2026");
  });

  it("the native $1 form keeps working unchanged", () => {
    const v = build("ab");
    setQuery(v, { search: "(a)(b)", replace: "$2$1", regexp: true });
    replaceAll(v);
    expect(v.state.doc.toString()).toBe("ba");
  });
});
