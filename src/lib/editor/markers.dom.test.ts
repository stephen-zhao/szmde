import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import type { RenderMode } from "./render-mode";

// These assert on the RENDERED DOM (decorations/widgets), not just the document
// text — the layer that `editing.test.ts` never touches. happy-dom has no CSS or
// real layout, so this catches decoration/structure regressions (a marker not
// hidden, a bullet not drawn) but NOT styling/WebView issues — see note at end.
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string, mode: RenderMode = "clean", caret = 0): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: editorExtensions(true, mode),
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

describe("Clean (Formatted) mode — rendered DOM", () => {
  it("renders an unordered-list marker as a • bullet, not raw '- '", () => {
    const v = build("- one\n- two");
    expect(count(v, ".cm-md-bullet")).toBe(2);
    expect(lineText(v, 0)).toBe("• one");
    expect(lineText(v, 0)).not.toContain("- ");
  });

  it("keeps an ordered-list number visible (recolored, not hidden)", () => {
    const v = build("1. one\n2. two");
    expect(count(v, ".cm-md-list-number")).toBe(2);
    expect(count(v, ".cm-md-bullet")).toBe(0);
    expect(lineText(v, 0)).toContain("1.");
  });

  it("hides a heading marker when the caret is on another line", () => {
    const v = build("para\n# Heading", "clean", 0); // caret on line 1
    expect(lineText(v, 1)).not.toContain("#");
    expect(lineText(v, 1)).toContain("Heading");
  });

  it("reveals the heading marker when the caret is on its line", () => {
    const v = build("para\n# Heading", "clean", 6); // caret on the heading line
    expect(lineText(v, 1)).toContain("#");
  });

  it("hides emphasis markers, leaving only the styled word", () => {
    const v = build("a **bold** c", "clean", 0);
    expect(lineText(v, 0)).toBe("a bold c");
  });
});

describe("Clean mode — list continuation hang-indent", () => {
  // A soft-broken continuation line's leading whitespace is replaced by an
  // invisible clone of the marker prefix, so the text aligns under the content
  // regardless of font. (happy-dom has no layout, so we assert the clone's
  // structure/glyphs — the width match is a CSS guarantee of visibility:hidden.)
  const hang = (v: EditorView, i = 0) =>
    v.contentDOM.querySelectorAll(".cm-md-hang-indent")[i]?.textContent ?? "";

  it("clones the bullet prefix '• ' on a bullet continuation line", () => {
    const v = build("- one\n  two");
    expect(count(v, ".cm-md-hang-indent")).toBe(1);
    expect(hang(v)).toBe("• ");
  });

  it("clones the number prefix '1. ' on an ordered continuation line", () => {
    const v = build("1. one\n   two");
    expect(count(v, ".cm-md-hang-indent")).toBe(1);
    expect(hang(v)).toBe("1. ");
  });

  it("includes the nesting indent in a nested item's clone ('  • ')", () => {
    const v = build("- a\n  - b\n    cont");
    expect(count(v, ".cm-md-hang-indent")).toBe(1);
    expect(hang(v)).toBe("  • ");
  });

  it("decorates every continuation line of a multi-line item", () => {
    const v = build("- one\n  two\n  three");
    expect(count(v, ".cm-md-hang-indent")).toBe(2);
  });

  it("uses the real marker classes so future marker styling matches", () => {
    const v = build("- one\n  two");
    const el = v.contentDOM.querySelector(".cm-md-hang-indent");
    expect(el?.querySelector(".cm-md-bullet")?.textContent).toBe("•");
  });

  it("does NOT hang-indent in Syntax mode (literal spaces stay)", () => {
    const v = build("- one\n  two", "markers-syntax");
    expect(count(v, ".cm-md-hang-indent")).toBe(0);
    expect(lineText(v, 1)).toBe("  two");
  });

  it("does NOT hang-indent in Source mode (literal spaces stay)", () => {
    const v = build("- one\n  two", "markers-rendered");
    expect(count(v, ".cm-md-hang-indent")).toBe(0);
    expect(lineText(v, 1)).toBe("  two");
  });
});

describe("Syntax mode — rendered DOM", () => {
  it("shows markers as small tokens, kept in the text", () => {
    const v = build("# Heading", "markers-syntax", 0);
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
    expect(lineText(v, 0)).toContain("#");
  });

  it("does NOT replace bullets with • (the dash stays as a token)", () => {
    const v = build("- one", "markers-syntax", 0);
    expect(count(v, ".cm-md-bullet")).toBe(0);
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
    expect(lineText(v, 0)).toContain("-");
  });
});

describe("Source (markers-rendered) mode — rendered DOM", () => {
  it("keeps emphasis markers visible while styling the construct", () => {
    const v = build("**bold**", "markers-rendered", 0);
    expect(count(v, ".cm-mk-strong")).toBeGreaterThan(0);
    expect(lineText(v, 0)).toContain("**");
  });

  it("does NOT replace bullets with • (the dash stays as plain text)", () => {
    const v = build("- one", "markers-rendered", 0);
    expect(count(v, ".cm-md-bullet")).toBe(0);
    expect(lineText(v, 0)).toContain("-");
  });
});
