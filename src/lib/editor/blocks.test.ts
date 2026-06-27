import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";

// blockConstructDecorations adds per-LINE classes for block constructs: a heading
// line gets cm-h1..cm-h6 (its level), and every line of a blockquote gets
// cm-blockquote. These assert on the rendered .cm-line classes — the observable
// output of the plugin — so a regression in level mapping or multi-line quote
// marking makes the test red. (No CSS in happy-dom, but class application is DOM.)
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
      extensions: editorExtensions(true, "clean"),
    }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}

// Class list for the nth (0-based) rendered editor line.
const lineClasses = (v: EditorView, n: number) =>
  Array.from(v.contentDOM.querySelectorAll(".cm-line")[n]?.classList ?? []);

describe("blockConstructDecorations — heading line classes", () => {
  it("maps each ATX level to its matching cm-h1..cm-h6 class", () => {
    const v = build("# a\n## b\n### c\n#### d\n##### e\n###### f");
    // Each heading line carries exactly the class for its own level.
    expect(lineClasses(v, 0)).toContain("cm-h1");
    expect(lineClasses(v, 1)).toContain("cm-h2");
    expect(lineClasses(v, 2)).toContain("cm-h3");
    expect(lineClasses(v, 3)).toContain("cm-h4");
    expect(lineClasses(v, 4)).toContain("cm-h5");
    expect(lineClasses(v, 5)).toContain("cm-h6");
  });

  it("does NOT cross-apply a sibling heading's level to the wrong line", () => {
    // Guards the level-mapping regression: an h1 line must not also get cm-h2.
    const v = build("# one\n## two");
    expect(lineClasses(v, 0)).toContain("cm-h1");
    expect(lineClasses(v, 0)).not.toContain("cm-h2");
    expect(lineClasses(v, 1)).toContain("cm-h2");
    expect(lineClasses(v, 1)).not.toContain("cm-h1");
  });
});

describe("blockConstructDecorations — blockquote line classes", () => {
  it("marks a single blockquote line with cm-blockquote", () => {
    const v = build("> quoted");
    expect(lineClasses(v, 0)).toContain("cm-blockquote");
  });

  it("marks EVERY line of a multi-line blockquote (lines 43-47 range clamp)", () => {
    // A contiguous 3-line blockquote is one Blockquote node spanning 3 lines;
    // the lo..hi loop must mark all three. If the range math regressed to only
    // the first/last line, the middle line would be bare and this fails.
    const v = build("> a\n> b\n> c");
    expect(lineClasses(v, 0)).toContain("cm-blockquote");
    expect(lineClasses(v, 1)).toContain("cm-blockquote");
    expect(lineClasses(v, 2)).toContain("cm-blockquote");
  });

  it("does not bleed the quote class onto a following paragraph line", () => {
    // The Blockquote node ends before the blank line + paragraph, so the
    // node.to-1 endLine clamp must stop marking at the last quoted line.
    const v = build("> q1\n> q2\n\nplain");
    expect(lineClasses(v, 0)).toContain("cm-blockquote");
    expect(lineClasses(v, 1)).toContain("cm-blockquote");
    expect(lineClasses(v, 3)).not.toContain("cm-blockquote");
  });
});

describe("blockConstructDecorations — non-construct and combined lines", () => {
  it("gives a plain paragraph line none of the block classes", () => {
    const v = build("just a paragraph");
    const cls = lineClasses(v, 0);
    expect(cls).not.toContain("cm-blockquote");
    for (let lvl = 1; lvl <= 6; lvl++) expect(cls).not.toContain("cm-h" + lvl);
  });

  it("combines heading + blockquote classes on one line for a quoted heading", () => {
    // A heading nested inside a blockquote ("> # h") exercises the Map-merge:
    // the single line collects BOTH cm-blockquote and cm-h1 (sorted/joined once).
    const v = build("> # h");
    const cls = lineClasses(v, 0);
    expect(cls).toContain("cm-blockquote");
    expect(cls).toContain("cm-h1");
  });
});
