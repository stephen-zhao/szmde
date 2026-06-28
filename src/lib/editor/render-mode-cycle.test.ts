import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { markerDecorations } from "./markers";
import { cycleRenderMode, renderModeOf } from "./render-mode";

// Regression guard for the "stuck render-mode toggle" class of bug: cycling the
// render mode must keep the marker decoration plugin alive and rebuilding, even
// with the caret inside tricky block constructs (nested blockquotes, quoted
// headings). If a build threw, CM would silently disable the plugin and the mode
// would appear frozen. (The focus-side of that bug — the app-level Ctrl+Shift+M
// fallback — lives in +page.svelte and is verified live.)
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string, caret: number): EditorView {
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

const pluginAlive = (v: EditorView) => v.plugin(markerDecorations) != null;

describe("render-mode cycle stays alive with the caret in a blockquote", () => {
  for (const [name, doc, caret] of [
    ["simple quote", "> quoted line", 3],
    ["caret on the quote marker", "> quoted line", 1],
    ["nested blockquote", "> > deep quote", 5],
    ["quoted heading", "> # quoted heading", 5],
    ["empty quote line", ">", 1],
  ] as [string, string, number][]) {
    it(`${name}: plugin survives clean → source → syntax`, () => {
      const errs = vi.spyOn(console, "error").mockImplementation(() => {});
      const v = build(doc, caret);
      cycleRenderMode(v); // → markers-rendered
      expect(renderModeOf(v.state)).toBe("markers-rendered");
      expect(pluginAlive(v)).toBe(true);
      cycleRenderMode(v); // → markers-syntax
      expect(renderModeOf(v.state)).toBe("markers-syntax");
      expect(pluginAlive(v)).toBe(true);
      // A block marker must still produce decorations; zero would mean a crash.
      expect(v.contentDOM.querySelectorAll(".cm-md-mark-syntax").length).toBeGreaterThan(0);
      expect(errs).not.toHaveBeenCalled();
      errs.mockRestore();
    });
  }

  it("a full clean→source→syntax→clean loop returns to clean", () => {
    const v = build("> quote", 3);
    cycleRenderMode(v);
    cycleRenderMode(v);
    cycleRenderMode(v);
    expect(renderModeOf(v.state)).toBe("clean");
  });
});
