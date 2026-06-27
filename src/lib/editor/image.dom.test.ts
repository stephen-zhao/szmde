import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { imageResolver } from "./images";
import type { RenderMode } from "./render-mode";

// Rendered-DOM tests for inline images (M2 S3). Clean mode replaces the
// `![alt](src)` node with an <img>; src for local/relative paths goes through an
// injectable resolver (Tauri convertFileSrc later), while http(s)/data pass
// through untouched. happy-dom gives us a real <img> element to inspect.
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string, mode: RenderMode = "clean", caret = 0, extra: Extension[] = []): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [...editorExtensions(true, mode), ...extra],
    }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}

const lineText = (v: EditorView, n: number) =>
  v.contentDOM.querySelectorAll(".cm-line")[n]?.textContent ?? "";
const count = (v: EditorView, sel: string) => v.contentDOM.querySelectorAll(sel).length;
const img = (v: EditorView) => v.contentDOM.querySelector<HTMLImageElement>("img.cm-md-image");

describe("[REQ-IMG-1] Images — Clean (Formatted) mode", () => {
  it("replaces ![alt](src) with an <img> carrying src + alt", () => {
    const v = build("x\n\n![cat](cat.png)"); // caret on line 0, image on line 2
    expect(count(v, "img.cm-md-image")).toBe(1);
    expect(img(v)?.getAttribute("src")).toBe("cat.png");
    expect(img(v)?.getAttribute("alt")).toBe("cat");
    expect(lineText(v, 2)).not.toContain("![");
  });

  it("reveals the literal markdown when the caret is within the image", () => {
    const v = build("![cat](cat.png)", "clean", 3); // caret inside the alt
    expect(count(v, "img.cm-md-image")).toBe(0);
    expect(lineText(v, 0)).toContain("![cat](cat.png)");
  });

  it("makes the hidden image atomic", () => {
    const v = build("x\n\n![cat](cat.png)", "clean", 0);
    let total = 0;
    for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
    expect(total).toBeGreaterThan(0);
  });
});

describe("[REQ-IMG-2] Images — src resolution", () => {
  it("passes remote http(s) and data: URLs through unchanged", () => {
    const v = build("x\n\n![x](https://example.com/a.png)", "clean", 0, [
      imageResolver.of((s) => "asset://" + s),
    ]);
    expect(img(v)?.getAttribute("src")).toBe("https://example.com/a.png");
  });

  it("routes local/relative paths through the injected resolver", () => {
    const v = build("x\n\n![x](pics/a.png)", "clean", 0, [imageResolver.of((s) => "asset://" + s)]);
    expect(img(v)?.getAttribute("src")).toBe("asset://pics/a.png");
  });

  it("defaults to identity resolution when no resolver is provided", () => {
    const v = build("x\n\n![x](pics/a.png)");
    expect(img(v)?.getAttribute("src")).toBe("pics/a.png");
  });

  it("resolves a reference-style image from its [id]: definition", () => {
    const v = build("![alt][id]\n\n[id]: ref.png", "clean", 12);
    expect(img(v)?.getAttribute("src")).toBe("ref.png");
    expect(img(v)?.getAttribute("alt")).toBe("alt");
  });

  it("leaves an unresolved reference image as literal text (no <img>)", () => {
    const v = build("![alt][missing]", "clean", 0);
    expect(count(v, "img.cm-md-image")).toBe(0);
    expect(lineText(v, 0)).toContain("![alt][missing]");
  });
});

describe("[REQ-IMG-1] Images — Source / Syntax modes", () => {
  it("Source mode keeps the literal markdown (no <img>)", () => {
    const v = build("![cat](cat.png)", "markers-rendered");
    expect(count(v, "img.cm-md-image")).toBe(0);
    expect(lineText(v, 0)).toContain("![cat](cat.png)");
  });

  it("Syntax mode keeps the literal markdown (no <img>)", () => {
    const v = build("![cat](cat.png)", "markers-syntax");
    expect(count(v, "img.cm-md-image")).toBe(0);
    expect(lineText(v, 0)).toContain("![cat](cat.png)");
  });
});
