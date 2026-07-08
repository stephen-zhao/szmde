import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  openSearchPanel,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import { editorExtensions } from "./setup";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string, caret = 0): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: editorExtensions(true, "clean"),
    }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}
const sel = (v: EditorView) => v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);

describe("[REQ-FR-1] find & replace", () => {
  it("opens and closes the search panel", () => {
    const v = build("hello world");
    openSearchPanel(v);
    expect(v.dom.querySelector(".cm-search")).not.toBeNull();
    closeSearchPanel(v);
    expect(v.dom.querySelector(".cm-search")).toBeNull();
  });

  it("findNext selects the match in the raw document text", () => {
    const v = build("foo bar foo");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "bar" })) });
    findNext(v);
    expect(sel(v)).toBe("bar");
  });

  it("replaceNext replaces a single occurrence", () => {
    const v = build("a a a");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "a", replace: "b" })) });
    findNext(v);
    replaceNext(v);
    expect(v.state.doc.toString()).toBe("b a a");
  });

  it("replaceAll replaces every occurrence", () => {
    const v = build("x x x");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "x", replace: "y" })) });
    replaceAll(v);
    expect(v.state.doc.toString()).toBe("y y y");
  });

  it("supports regex queries", () => {
    const v = build("cat cot cut");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "c.t", regexp: true })) });
    findNext(v);
    expect(sel(v)).toMatch(/^c.t$/);
  });

  it("respects the case-sensitive flag", () => {
    const v = build("Foo foo");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "foo", caseSensitive: true })) });
    findNext(v);
    expect(v.state.selection.main.from).toBe(4); // the lowercase 'foo', not 'Foo'
  });

  it("selecting a match on a Clean-mode marker line reveals (greys) the marker", () => {
    // caret on line 0 → the '# ' on line 1 hangs TRANSPARENT in the gutter (present
    // but invisible). A search selection landing on the line reveals it = greys it.
    const v = build("para\n# Heading", 0);
    const line = () => v.contentDOM.querySelectorAll(".cm-line")[1] as HTMLElement;
    expect(line().querySelector(".cm-md-mark-invisible")).not.toBeNull(); // transparent off-cursor
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "Heading" })) });
    findNext(v); // selection lands on the heading line → reveal-on-cursor greys '#'
    expect(line().querySelector(".cm-md-mark-invisible")).toBeNull(); // now grey, not transparent
    expect(line().querySelector(".cm-md-mark-syntax")).not.toBeNull();
  });
});
