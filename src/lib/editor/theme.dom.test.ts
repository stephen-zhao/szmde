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

describe("[REQ-LANE-4] Editor theme — lane open-scalar wired into the width consumers", () => {
  it("multiplies each lane's reserved width by its open scalar in BOTH consumers", () => {
    // Mutation guard: dropping the `* var(--*-open,1)` factor (so a collapse no longer
    // shrinks the width) would leave every layout/DOM unit test green because none
    // read the emitted rule text. Assert the factor is present in the padding-left
    // rule (.cm-content) AND the chevron-left rule, and that the chevron fades/shrinks
    // with the fold scalar so it hides on collapse (the adversarial-review regression).
    view = new EditorView({
      state: EditorState.create({ doc: "", extensions: editorExtensions() }),
      parent: document.body,
    });
    const css = collectInjectedCss().replace(/\s+/g, " ");
    // .cm-content padding-left: 28px + fold-col×fold-open + marker-gutter×marker-open
    expect(css).toMatch(/padding-left:[^;]*var\(--fold-col[^;]*\)\s*\*\s*var\(--fold-open/);
    expect(css).toMatch(/padding-left:[^;]*var\(--marker-gutter[^;]*\)\s*\*\s*var\(--marker-open/);
    // .cm-fold-chevron left tracks the same width×open expression …
    expect(css).toMatch(/var\(--fold-open, ?1\)/);
    expect(css).toMatch(/var\(--marker-open, ?1\)/);
    // … and its visibility follows the fold scalar (opacity + scale) so a collapsed
    // drawer's chevron neither shows nor intercepts clicks over the heading text.
    expect(css).toMatch(/opacity: ?var\(--fold-open/);
    expect(css).toMatch(/transform: ?scale\(var\(--fold-open/);
  });
});
