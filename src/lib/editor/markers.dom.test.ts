import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { markerAtomicRanges } from "./markers";
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

describe("[REQ-RENDER-2][REQ-RENDER-3] Clean (Formatted) mode — rendered DOM", () => {
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

  it("an ordered TASK item shows only the checkbox, NOT a stray '1.' ordinal", () => {
    // A task item defers its whole prefix to tasks.ts (the checkbox); markers.ts
    // must not also draw the ordinal — true for ordered lists too, not just bullets.
    const v = build("1. [ ] todo", "clean");
    expect(count(v, ".cm-md-task")).toBe(1); // the checkbox renders
    expect(count(v, ".cm-md-list-number")).toBe(0); // no stray ordinal
    expect(count(v, ".cm-md-bullet")).toBe(0);
    expect(lineText(v, 0)).not.toContain("1.");
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

  it("[REQ-RENDER-8] hides the heading marker's trailing space too (heading text is flush)", () => {
    const v = build("para\n# Heading", "clean", 0); // caret on line 0 → heading rendered
    expect(lineText(v, 1)).toBe("Heading"); // no leading space from the `# `
  });

  it("[REQ-RENDER-8] hides the trailing space for deeper headings (## etc.)", () => {
    const v = build("para\n### Deep", "clean", 0);
    expect(lineText(v, 1)).toBe("Deep");
  });

  it("[REQ-RENDER-8] handles a heading marker with no trailing space (in-progress `#`)", () => {
    const v = build("para\n#", "clean", 0);
    expect(lineText(v, 1)).toBe(""); // `#` hidden; nothing to trim after it
  });

  it("[REQ-RENDER-8] hides the blockquote marker's trailing space too (quote text is flush)", () => {
    const v = build("para\n> quote", "clean", 0); // caret on line 0 → quote rendered
    expect(lineText(v, 1)).toBe("quote"); // no leading space from the `> `
  });
});

describe("[REQ-LIST-6] Clean mode — list continuation hang-indent", () => {
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

  it("includes the nesting indent in a nested item's clone ('  ◦ ')", () => {
    // The depth-2 item's bullet is ◦ (depth-varied glyph), so the continuation
    // clone matches it — proving the clone tracks the real marker, not a fixed •.
    const v = build("- a\n  - b\n    cont");
    expect(count(v, ".cm-md-hang-indent")).toBe(1);
    expect(hang(v)).toBe("  ◦ ");
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

describe("[REQ-RENDER-4] Syntax mode — rendered DOM", () => {
  it("shows markers as small tokens, kept in the text", () => {
    const v = build("# Heading", "markers-syntax", 0);
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
    expect(lineText(v, 0)).toContain("#");
  });

  it("does NOT replace bullets with •, and shows the dash in NORMAL style (not small-grey)", () => {
    // [REQ-RENDER-9 bug B4] A list marker is content (it renders as a •), so in
    // Syntax mode it keeps normal text styling — it must NOT get the small-grey
    // .cm-md-mark-syntax token look, only the normal .cm-md-list-marker class.
    const v = build("- one", "markers-syntax", 0);
    expect(count(v, ".cm-md-bullet")).toBe(0);
    expect(count(v, ".cm-md-list-marker")).toBe(1);
    expect(count(v, ".cm-md-mark-syntax")).toBe(0); // never small-grey
    expect(lineText(v, 0)).toContain("-");
  });

  it("[bug B4] shows an ordered number's literal in NORMAL style (not small-grey)", () => {
    const v = build("1. one", "markers-syntax", 0);
    expect(count(v, ".cm-md-list-number")).toBe(0); // not the computed-ordinal widget
    expect(count(v, ".cm-md-list-marker")).toBe(1); // literal `1.` in normal style
    expect(count(v, ".cm-md-mark-syntax")).toBe(0);
    expect(lineText(v, 0)).toContain("1.");
  });
});

describe("[REQ-RENDER-9] Syntax mode — block markers hang in the left margin (in-flow)", () => {
  // The hung marker is an in-flow Decoration.mark, not a replace widget; CM splits
  // the marked range into adjacent spans at a highlight boundary (between '#' and
  // the space), so concatenate all hang spans' text.
  const hang = (v: EditorView) =>
    Array.from(v.contentDOM.querySelectorAll(".cm-md-mark-hang"))
      .map((e) => e.textContent)
      .join("");
  // The cm-widgetBuffer zero-width spans are inserted by CM around REPLACE/WIDGET
  // decorations, never around a plain mark. Their absence on the marker line is the
  // structural proof the marker is in-flow editable text (bugs B2/B6), not a widget.
  const widgetBuffers = (v: EditorView, line = 0) =>
    v.contentDOM.querySelectorAll(".cm-line")[line]?.querySelectorAll(".cm-widgetBuffer").length ?? 0;
  const atomicSize = (v: EditorView) => {
    let total = 0;
    for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
    return total;
  };

  it("hangs a heading marker + its trailing space ('# ') as in-flow editable text", () => {
    const v = build("# Heading", "markers-syntax", 0);
    expect(hang(v)).toBe("# "); // marker + trailing space, kept as real text
    expect(count(v, ".cm-md-mark-hang")).toBeGreaterThan(0);
    expect(lineText(v, 0)).toContain("Heading");
    // In-flow (bugs B2/B6): the marker is a mark, so no widget buffers wrap it and
    // nothing is atomic — the caret glides into '#'/space, and they're selectable.
    expect(widgetBuffers(v)).toBe(0);
    expect(atomicSize(v)).toBe(0);
  });

  it("hangs a deeper heading marker ('### ')", () => {
    const v = build("### Deep", "markers-syntax", 0);
    expect(hang(v)).toBe("### ");
  });

  it("hangs a blockquote marker ('> ') and keeps it in-flow (bug B6)", () => {
    const v = build("> quote", "markers-syntax", 0);
    expect(hang(v)).toBe("> ");
    expect(widgetBuffers(v)).toBe(0);
    expect(atomicSize(v)).toBe(0);
  });

  it("hangs each '>' of a nested blockquote, all in-flow", () => {
    const v = build("> > deep", "markers-syntax", 0);
    expect(hang(v)).toBe("> > ");
    expect(widgetBuffers(v)).toBe(0);
  });

  it("does NOT hang inline markers (they stay plain syntax tokens)", () => {
    const v = build("a **bold**", "markers-syntax", 0);
    expect(count(v, ".cm-md-mark-hang")).toBe(0);
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
  });

  it("emits no hang decorations in Source mode, nor in Clean mode off the line", () => {
    expect(count(build("# H", "markers-rendered", 0), ".cm-md-mark-hang")).toBe(0);
    // Clean mode with the caret on ANOTHER line → marker hidden, not hung.
    expect(count(build("para\n# H", "clean", 0), ".cm-md-mark-hang")).toBe(0);
  });

  it("does NOT hang a setext underline (it's not a leading ATX marker)", () => {
    const v = build("Title\n=====", "markers-syntax", 0);
    expect(count(v, ".cm-md-mark-hang")).toBe(0); // the ===== underline isn't hung
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0); // shown as a plain token
  });

  it("hangs only the OPENING marker of an ATX heading with a closing #", () => {
    const v = build("# H #", "markers-syntax", 0);
    expect(hang(v)).toBe("# "); // only the leading '# ', not the trailing closing #
    // The closing '#' is a non-block HeaderMark → small-grey token, not hung.
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(count(v, ".cm-md-mark-hang"));
  });

  it("keeps the hung marker's DOM stable across an unrelated edit", () => {
    const v = build("# Heading", "markers-syntax", 0);
    const before = v.contentDOM.querySelector(".cm-md-mark-hang");
    expect(before?.textContent).toBe("#");
    v.dispatch({ changes: { from: v.state.doc.length, insert: "!" } }); // edit far from the marker
    forceParsing(v, v.state.doc.length, 5000);
    expect(v.contentDOM.querySelector(".cm-md-mark-hang")?.textContent).toBe("#");
  });
});

describe("[REQ-RENDER-11] Formatted mode — reveal-on-cursor renders Syntax-style markers", () => {
  const hang = (v: EditorView) =>
    Array.from(v.contentDOM.querySelectorAll(".cm-md-mark-hang"))
      .map((e) => e.textContent)
      .join("");

  it("reveals a heading marker as a hung Syntax-style mark, not a raw literal", () => {
    const v = build("# Heading", "clean", 2); // caret on the heading line
    expect(hang(v)).toBe("# "); // hung, exactly like Syntax mode
    expect(count(v, ".cm-md-mark-hang")).toBeGreaterThan(0);
    expect(lineText(v, 0)).toContain("Heading");
  });

  it("reveals a blockquote marker as a hung Syntax-style mark", () => {
    const v = build("> quote", "clean", 3);
    expect(hang(v)).toBe("> ");
  });

  it("reveals an inline emphasis marker as a small-grey Syntax token", () => {
    const v = build("a **bold** c", "clean", 5); // caret inside **bold**
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
    expect(count(v, ".cm-mk-strong")).toBe(0); // NOT the Source-mode rendered marker
    expect(lineText(v, 0)).toContain("**");
  });
});

describe("[REQ-RENDER-5] Source (markers-rendered) mode — rendered DOM", () => {
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

  it("styles strikethrough markers with .cm-mk-strike while keeping them visible", () => {
    // GFM ~~ markers: in Source mode both the opening and closing ~~ get the
    // cm-mk-strike class (StrikethroughMark case) and stay in the text.
    const v = build("~~gone~~", "markers-rendered", 0);
    expect(count(v, ".cm-mk-strike")).toBe(2);
    expect(lineText(v, 0)).toContain("~~");
  });

  it("styles inline-code backticks with .cm-mk-code while keeping them visible", () => {
    // CodeMark inside InlineCode → cm-mk-code; opening and closing backtick.
    const v = build("a `code` b", "markers-rendered", 0);
    expect(count(v, ".cm-mk-code")).toBe(2);
    expect(lineText(v, 0)).toContain("`");
  });

  it("does NOT style fenced-code fence markers (CodeMark outside InlineCode is skipped)", () => {
    // The ``` fences are CodeMark nodes too, but their parent is FencedCode, not
    // InlineCode, so the rendered branch is `undefined` and no cm-mk-code is emitted.
    const v = build("```\nx\n```", "markers-rendered", 0);
    expect(count(v, ".cm-mk-code")).toBe(0);
    expect(lineText(v, 0)).toContain("```");
  });
});

describe("Clean mode — strikethrough marker hiding", () => {
  it("hides ~~ markers when the caret is off the construct, leaving only the word", () => {
    // StrikethroughMark in clean mode with the caret elsewhere → both ~~ hidden.
    const v = build("a ~~gone~~ b", "clean", 0);
    expect(lineText(v, 0)).toBe("a gone b");
  });
});

describe("BulletWidget DOM reuse (eq returns true)", () => {
  // BulletWidget.eq() returns true unconditionally: all bullets are
  // interchangeable, so CodeMirror reuses the existing widget DOM across edits
  // instead of re-rendering it. If eq returned false the node would be replaced.
  it("keeps the same • DOM node after an edit elsewhere on the line", () => {
    const v = build("- one", "clean", 5); // caret at end, bullet at col 0
    const before = v.contentDOM.querySelector(".cm-md-bullet");
    expect(before?.textContent).toBe("•");
    // Append text far from the marker; decorations rebuild but the bullet is
    // identical, so eq() lets CodeMirror reuse the very same element instance.
    v.dispatch({ changes: { from: 5, insert: "X" }, selection: EditorSelection.cursor(6) });
    forceParsing(v, v.state.doc.length, 5000);
    const after = v.contentDOM.querySelector(".cm-md-bullet");
    expect(after).toBe(before); // same instance → DOM was reused, not recreated
    expect(v.state.doc.toString()).toBe("- oneX");
  });
});

describe("markerAtomicRanges — hidden markers become atomic", () => {
  // The exported facet maps the view to the marker plugin's `hidden` RangeSet so
  // arrow keys skip hidden markers. It defends with `?? RangeSet.empty` when the
  // plugin isn't installed.
  it("contributes an atomic range for a hidden marker in clean mode", () => {
    const v = build("para\n# H", "clean", 0); // caret on line 1 → '# ' on line 2 hidden
    let total = 0;
    for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
    expect(total).toBeGreaterThan(0);
  });

  it("contributes no atomic ranges in Source mode (nothing is hidden)", () => {
    const v = build("para\n# H", "markers-rendered", 0);
    let total = 0;
    for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
    expect(total).toBe(0);
  });

  it("[REQ-RENDER-6] falls back to an empty set when the marker plugin is absent", () => {
    // markerAtomicRanges alone, with no markerDecorations plugin to read from:
    // the `view.plugin(...) ?? RangeSet.empty` fallback must yield an empty set.
    view = new EditorView({
      state: EditorState.create({ doc: "# H", extensions: [markerAtomicRanges] }),
      parent: document.body,
    });
    const fns = view.state.facet(EditorView.atomicRanges);
    expect(fns.length).toBe(1);
    expect(fns[0](view).size).toBe(0);
  });
});
