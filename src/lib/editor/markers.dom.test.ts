import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { cursorCharRight } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import { markerAtomicRanges, remeasureMarkers } from "./markers";
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

  it("renders an off-cursor heading marker TRANSPARENT + gutter-hung (present, not removed)", () => {
    const v = build("para\n# Heading", "clean", 0); // caret on line 0
    const line = v.contentDOM.querySelectorAll(".cm-line")[1] as HTMLElement;
    // Present in flow but invisible (so revealing it → grey doesn't reflow the
    // content — no jitter), and hung in the gutter so the heading reads flush.
    expect(line.querySelector(".cm-md-mark-invisible")).not.toBeNull();
    expect(line.getAttribute("style") || "").toContain("text-indent");
    expect(lineText(v, 1)).toContain("Heading");
  });

  it("reveals the heading marker as GREY (not transparent) when the caret is on its line", () => {
    const v = build("para\n# Heading", "clean", 6); // caret on the heading line
    const line = v.contentDOM.querySelectorAll(".cm-line")[1] as HTMLElement;
    expect(line.querySelector(".cm-md-mark-syntax")).not.toBeNull();
    expect(line.querySelector(".cm-md-mark-invisible")).toBeNull(); // grey, not transparent
  });

  it("hides emphasis markers, leaving only the styled word", () => {
    const v = build("a **bold** c", "clean", 0);
    expect(lineText(v, 0)).toBe("a bold c");
  });

  // REQ-RENDER-8 (heading/quote text flush): the marker prefix (incl. its trailing
  // space) hangs transparent in the gutter via text-indent, so the content reads
  // flush — without the marker being removed (which is what used to jitter on reveal).
  const offCursorLine = (doc: string, lineIdx: number) => {
    const v = build(doc, "clean", 0); // caret on line 0, marker line off-cursor
    return v.contentDOM.querySelectorAll(".cm-line")[lineIdx] as HTMLElement;
  };

  it("[REQ-RENDER-8] an off-cursor heading is flush via the gutter hang (marker transparent)", () => {
    const line = offCursorLine("para\n# Heading", 1);
    expect(line.getAttribute("style") || "").toContain("text-indent"); // flush via gutter
    expect(line.querySelector(".cm-md-mark-invisible")).not.toBeNull(); // marker invisible
  });

  it("[REQ-RENDER-8] same for a deeper heading (###)", () => {
    const line = offCursorLine("para\n### Deep", 1);
    expect(line.getAttribute("style") || "").toContain("text-indent");
    expect(line.querySelector(".cm-md-mark-invisible")).not.toBeNull();
  });

  it("[REQ-RENDER-8] handles a bare heading marker '#' (no trailing space)", () => {
    const line = offCursorLine("para\n#", 1);
    expect(line.querySelector(".cm-md-mark-invisible")).not.toBeNull();
  });

  it("[REQ-RENDER-8] same for a blockquote marker", () => {
    const line = offCursorLine("para\n> quote", 1);
    expect(line.getAttribute("style") || "").toContain("text-indent");
    expect(line.querySelector(".cm-md-mark-invisible")).not.toBeNull();
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

describe("[REQ-RENDER-9][REQ-RENDER-12] Syntax mode — block markers hang in the gutter (in-flow)", () => {
  // The block-marker prefix (`#…`/`>`(s) + spaces) is small-greyed (.cm-md-mark-syntax)
  // and the LINE is text-indented by the prefix's measured width, so the markers hang
  // in the gutter column while the content stays flush AND the caret follows (the
  // text-indent moves the line's inline origin, not just the glyph — the WebView2
  // caret fix). happy-dom has no canvas, so the indent value is 0 here (the pixel
  // shift is verified live, WF-24); we assert the structure: a text-indent line deco
  // is present, the prefix is small-grey, and it's in-flow editable (not atomic).
  const lineEl = (v: EditorView, n = 0) => v.contentDOM.querySelectorAll(".cm-line")[n] as HTMLElement;
  const hasIndent = (v: EditorView, n = 0) => (lineEl(v, n)?.getAttribute("style") || "").includes("text-indent");
  // The small-grey prefix is ONE mark decoration but CM splits it into several DOM
  // spans at highlight boundaries (`#` vs the heading-text space); count the joined
  // text, not the span count, to assert the whole prefix is small-greyed.
  const syntaxText = (v: EditorView, n = 0) =>
    Array.from(lineEl(v, n)?.querySelectorAll(".cm-md-mark-syntax") ?? [])
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

  it("hangs a heading marker prefix as in-flow editable text via a line text-indent", () => {
    const v = build("# Heading", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true); // the line carries the gutter text-indent deco
    expect(syntaxText(v)).toBe("# "); // the whole `# ` prefix is small-grey
    expect(lineText(v, 0)).toBe("# Heading"); // full marker + space + text all present
    // In-flow (bugs B2/B6): the marker is a mark, so no widget buffers wrap it and
    // nothing is atomic — the caret glides into '#'/space, and they're selectable.
    expect(widgetBuffers(v)).toBe(0);
    expect(atomicSize(v)).toBe(0);
  });

  it("hangs a deeper heading marker ('###') with the whole prefix + one indent", () => {
    const v = build("### Deep", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("### "); // `### ` prefix small-grey
    expect(lineText(v, 0)).toBe("### Deep");
  });

  it("hangs a blockquote marker ('>') and keeps it in-flow (bug B6)", () => {
    const v = build("> quote", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("> ");
    expect(lineText(v, 0)).toBe("> quote");
    expect(widgetBuffers(v)).toBe(0);
    expect(atomicSize(v)).toBe(0);
  });

  it("hangs a nested blockquote's whole prefix once ('> > '), all in-flow", () => {
    const v = build("> > deep", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("> > "); // the whole `> > ` prefix, one indent
    expect(lineText(v, 0)).toBe("> > deep");
    expect(widgetBuffers(v)).toBe(0);
  });

  it("[bug] hangs an INDENTED heading (≤3 leading spaces — valid CommonMark ATX)", () => {
    // The old `^`-anchored regex matched only column-0 markers, so `   # x` (lezer
    // parses it as a real ATXHeading) rendered full-size, never greyed/hung.
    const v = build("   # indented", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("   # "); // leading indent + marker + space hang together
  });

  it("[bug] hangs an INDENTED blockquote marker too", () => {
    const v = build("  > quote", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("  > ");
  });

  it("[bug] does NOT grey/over-indent a CONTENT '#' after the heading marker", () => {
    // `# # heading`: lezer marks only the first `#`; the second is content. A naive
    // `[>#]+` greyed both and over-indented — the prefix must stop at the real marker.
    const v = build("# # heading", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("# "); // only the leading `# `, not the content `#`
  });

  it("[bug] does NOT grey a content '#' inside a blockquote ('> #tag')", () => {
    // `#tag` has no space → not a heading → content; only the `>` is a block marker.
    const v = build("> #tag here", "markers-syntax", 0);
    expect(syntaxText(v)).toBe("> ");
  });

  it("does NOT hang inline markers (they stay plain syntax tokens, no line indent)", () => {
    const v = build("a **bold**", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(false); // no block marker on the line → no gutter indent
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
  });

  it("emits no gutter indent in Source mode (literal markers, no hang)", () => {
    expect(hasIndent(build("# H", "markers-rendered", 0))).toBe(false);
    // NB: Clean mode off-line DOES hang now — transparent, so reveal doesn't reflow
    // (asserted in the Clean-mode describe). Source is the only mode with no hang.
  });

  it("treats a setext underline as a plain in-place token, NOT a gutter-hung block marker", () => {
    const v = build("Title\n=====", "markers-syntax", 0);
    expect(hasIndent(v, 0)).toBe(false); // Title line: no marker
    expect(hasIndent(v, 1)).toBe(false); // underline is NOT gutter-hung (ATX-only exclusion)
    expect(syntaxText(v, 1)).toBe("====="); // shown small-grey IN PLACE (proves the exclusion)
  });

  it("hangs only the OPENING marker of an ATX heading with a closing #", () => {
    const v = build("# H #", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true);
    // The leading prefix `# ` is hung; the trailing closing `#` is a non-block
    // HeaderMark → a plain in-place small-grey token. Both are small-grey, so the
    // joined syntax text is `# ` + `#`; the gutter indent reflects ONLY the prefix.
    expect(syntaxText(v)).toBe("# #");
  });

  it("keeps the hung marker's DOM stable across an unrelated edit", () => {
    const v = build("# Heading", "markers-syntax", 0);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("# ");
    v.dispatch({ changes: { from: v.state.doc.length, insert: "!" } }); // edit far from the marker
    forceParsing(v, v.state.doc.length, 5000);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("# ");
  });
});

describe("[REQ-RENDER-11] Formatted mode — reveal-on-cursor renders Syntax-style markers", () => {
  const lineEl = (v: EditorView, n = 0) => v.contentDOM.querySelectorAll(".cm-line")[n] as HTMLElement;
  const hasIndent = (v: EditorView, n = 0) => (lineEl(v, n)?.getAttribute("style") || "").includes("text-indent");
  const syntaxText = (v: EditorView, n = 0) =>
    Array.from(lineEl(v, n)?.querySelectorAll(".cm-md-mark-syntax") ?? [])
      .map((e) => e.textContent)
      .join("");

  it("reveals a heading marker as a gutter-hung Syntax-style prefix, not a raw literal", () => {
    const v = build("# Heading", "clean", 2); // caret on the heading line
    expect(hasIndent(v)).toBe(true); // hung in the gutter, exactly like Syntax mode
    expect(syntaxText(v)).toBe("# ");
    expect(lineText(v, 0)).toBe("# Heading");
  });

  it("reveals a blockquote marker as a gutter-hung Syntax-style prefix", () => {
    const v = build("> quote", "clean", 3);
    expect(hasIndent(v)).toBe(true);
    expect(syntaxText(v)).toBe("> ");
  });

  it("reveals an inline emphasis marker as a small-grey Syntax token", () => {
    const v = build("a **bold** c", "clean", 5); // caret inside **bold**
    expect(count(v, ".cm-md-mark-syntax")).toBeGreaterThan(0);
    expect(count(v, ".cm-mk-strong")).toBe(0); // NOT the Source-mode rendered marker
    expect(lineText(v, 0)).toContain("**");
  });
});

describe("cursor gliding across markers — document-flow contract", () => {
  // The "smooth gliding" requirement: in Syntax/Source the marker chars are real,
  // non-atomic text the caret steps through one position at a time; in Clean mode a
  // HIDDEN marker is atomic so the caret skips it as a single unit. (The VISUAL
  // caret position — e.g. the gutter overhang — needs real layout and is verified
  // live in WF-24; here we lock the document-flow contract that makes it smooth.)
  const atomicSize = (v: EditorView) => {
    let total = 0;
    for (const fn of v.state.facet(EditorView.atomicRanges)) total += fn(v).size;
    return total;
  };
  // Whether an atomic range covers the INTERIOR of `pos` (so the live view's
  // movement layer skips it). happy-dom's cursorCharRight does logical stepping but
  // not the layout-layer atomic skip, so we assert that contract on the range set.
  const atomicCovers = (v: EditorView, pos: number) => {
    let covered = false;
    for (const fn of v.state.facet(EditorView.atomicRanges)) {
      fn(v).between(0, v.state.doc.length, (from, to) => {
        if (from < pos && pos < to) covered = true;
      });
    }
    return covered;
  };
  // Arrow-glide right from `start`, collecting each landed position until `steps`.
  const glideRight = (v: EditorView, start: number, steps: number) => {
    v.dispatch({ selection: EditorSelection.cursor(start) });
    const seen = [v.state.selection.main.head];
    for (let i = 0; i < steps; i++) {
      cursorCharRight(v);
      seen.push(v.state.selection.main.head);
    }
    return seen;
  };

  it("[REQ-RENDER-9] Syntax mode: caret steps through every char of a heading marker (no skips)", () => {
    const v = build("ab\n# Heading", "markers-syntax", 0);
    // From end of line 1 (pos 2), right-arrow must visit: 3 (line2 start, before #),
    // 4 (after #), 5 (after space), 6 (after 'H') — one position each, nothing skipped.
    expect(glideRight(v, 2, 4)).toEqual([2, 3, 4, 5, 6]);
    expect(atomicSize(v)).toBe(0); // nothing atomic → caret can rest on every char
  });

  it("[REQ-RENDER-9] Syntax mode: caret steps through a blockquote '>' marker", () => {
    const v = build("ab\n> quote", "markers-syntax", 0);
    expect(glideRight(v, 2, 3)).toEqual([2, 3, 4, 5]); // \n, >, space, q
    expect(atomicSize(v)).toBe(0);
  });

  it("Source mode: marker chars are non-atomic, caret steps one-by-one", () => {
    const v = build("# Heading", "markers-rendered", 9);
    expect(glideRight(v, 0, 3)).toEqual([0, 1, 2, 3]); // #, space, H, e
    expect(atomicSize(v)).toBe(0);
  });

  it("Clean mode: an off-cursor BLOCK marker is transparent-in-flow, NOT atomic (glides like Syntax)", () => {
    // Block markers are no longer removed/atomic in Clean mode — they keep their slot
    // (transparent) so revealing doesn't reflow, and the caret steps through them
    // exactly as in Syntax mode (pos 4, between '#' and space, is reachable in both).
    const v = build("ab\n# Heading", "clean", 0);
    expect(atomicCovers(v, 4)).toBe(false);
    expect(atomicCovers(build("ab\n# Heading", "markers-syntax", 0), 4)).toBe(false);
  });

  it("Clean mode: a hidden INLINE marker IS still atomic (only block markers changed)", () => {
    // Inline markers are removed off-cursor (reserving their slot would leave gaps),
    // so they stay atomic — the caret skips the hidden `**` as a unit.
    const v = build("x **bold** y", "clean", 0); // caret off the construct
    expect(atomicSize(v)).toBeGreaterThan(0);
  });

  it("the gutter hang is carried by a line DECORATION (re-applied on every render)", () => {
    // Regression guard for the cursor-jump bug: the left-shift must be an attribute
    // on a decoration (so CM re-applies it on each line re-render), NOT a style
    // mutated by a post-layout plugin (which CM blows away on re-render). It's now a
    // `text-indent` line decoration — which (unlike the old per-marker margin) also
    // moves the caret, since it shifts the line's inline origin.
    const v = build("# Heading", "markers-syntax", 0);
    const line = v.contentDOM.querySelector(".cm-line") as HTMLElement;
    expect(line?.getAttribute("style") || "").toContain("text-indent");
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
  it("contributes an atomic range for a hidden INLINE marker in clean mode", () => {
    // Block markers are transparent-in-flow (non-atomic) now; inline markers (here
    // the emphasis `**`) are still hidden + atomic off-cursor.
    const v = build("a **b** c", "clean", 0);
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

describe("[REQ-RENDER-9] remeasureMarkers effect rebuilds the gutter", () => {
  // The font-change watcher (remeasureOnFontChange, a browser-only ViewPlugin) is
  // v8-ignored and verified live (WF-24); here we lock the effect→rebuild contract
  // it depends on: dispatching remeasureMarkers re-runs the decoration build (so a
  // new font metric takes effect) without throwing and with the markers intact.
  it("rebuilds marker decorations on the effect, markers still hung & correct", () => {
    const v = build("# Heading", "markers-syntax", 0);
    const line = () => v.contentDOM.querySelector(".cm-line") as HTMLElement;
    expect((line().getAttribute("style") || "")).toContain("text-indent");
    v.dispatch({ effects: remeasureMarkers.of(null) }); // the path remeasureOnFontChange fires
    expect((line().getAttribute("style") || "")).toContain("text-indent");
    expect(lineText(v, 0)).toBe("# Heading");
  });
});
