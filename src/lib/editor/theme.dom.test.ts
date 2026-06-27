import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { editorExtensions } from "./setup";

// Guards a CSS layout invariant, not behavior: happy-dom has no layout engine or
// scrollbars, so it cannot prove the document doesn't shift when the scrollbar
// appears (that needs a real WebView E2E). What it CAN do is confirm the theme
// still emits the rule that reserves the scrollbar gutter — i.e. catch someone
// silently dropping it in a refactor.
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function collectInjectedCss(): string {
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + "\n";
    } catch {
      /* cross-origin/unreadable — ignore */
    }
  }
  document.querySelectorAll("style").forEach((s) => (css += (s.textContent ?? "") + "\n"));
  return css;
}

describe("[REQ-UI-1] Editor theme — scrollbar gutter", () => {
  it("reserves a stable scrollbar gutter so the centered column never shifts", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "", extensions: editorExtensions() }),
      parent: document.body,
    });
    const css = collectInjectedCss();
    expect(css).toContain("scrollbar-gutter");
    expect(css).toContain("stable both-edges");
  });
});
