import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { forceParsing, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { editorExtensions } from "./setup";

// frontmatter.ts adds a custom Lezer block parser that recognizes a `---` … `---`
// preamble at the very start of the document as ONE `Frontmatter` node. Without it
// CommonMark reads `key: value` followed by `---` as a setext heading, turning a
// YAML preamble into a giant H2. These tests build a real EditorState (the full
// editor extension set wires Frontmatter into the markdown parser), force the
// markdown parse, then walk the syntax tree — so a regression in the block parser
// (wrong node, wrong span, claiming a non-leading `---`) makes the test FAIL.
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function parse(doc: string): EditorState {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
      extensions: editorExtensions(),
    }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v.state;
}

/** All nodes with the given name, in document order. */
function nodesNamed(state: EditorState, name: string): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === name) found.push(node.node);
    },
  });
  return found;
}

/** The single Frontmatter node, or undefined if none exists. */
function frontmatter(state: EditorState): SyntaxNode | undefined {
  const all = nodesNamed(state, "Frontmatter");
  expect(all.length).toBeLessThanOrEqual(1); // there is at most one preamble
  return all[0];
}

describe("[REQ-BLOCK-4] Frontmatter block parser", () => {
  it("treats a leading `--- … ---` YAML block as one Frontmatter node", () => {
    const doc = "---\ntitle: Hello\ntags: [a, b]\n---\n\nbody text";
    const state = parse(doc);
    const fm = frontmatter(state);
    expect(fm).toBeDefined();
    // Spans from the opening fence (offset 0) through the END of the closing
    // fence line — NOT past the trailing newline, and NOT into the body.
    expect(fm!.from).toBe(0);
    expect(fm!.to).toBe(doc.indexOf("\n\nbody"));
    expect(state.sliceDoc(fm!.from, fm!.to)).toBe("---\ntitle: Hello\ntags: [a, b]\n---");
  });

  it("emits FrontmatterMark children for the opening and closing fences", () => {
    const doc = "---\nkey: value\n---\nbody";
    const state = parse(doc);
    const fm = frontmatter(state);
    expect(fm).toBeDefined();
    const marks = nodesNamed(state, "FrontmatterMark");
    expect(marks.length).toBe(2); // opening + closing fence, not the body line
    // Opening fence is the first `---` (offset 0..3).
    expect([marks[0].from, marks[0].to]).toEqual([0, 3]);
    // Closing fence is the third line's `---`.
    const closeAt = doc.lastIndexOf("---");
    expect([marks[1].from, marks[1].to]).toEqual([closeAt, closeAt + 3]);
  });

  it("does NOT parse the inner `key: value` line as a setext heading", () => {
    // The whole point of the extension: the line before the closing `---` must
    // not become a SetextHeading (the CommonMark default that this guards against).
    const doc = "---\ntitle: Hello\n---\nbody";
    const state = parse(doc);
    expect(frontmatter(state)).toBeDefined();
    expect(nodesNamed(state, "SetextHeading")).toHaveLength(0);
  });

  it("parses an unclosed leading block greedily to EOF as Frontmatter", () => {
    // Mid-typing: opening fence, some keys, but no closing `---` yet.
    const doc = "---\ntitle: Hello\ntags: still typing";
    const state = parse(doc);
    const fm = frontmatter(state);
    expect(fm).toBeDefined();
    expect(fm!.from).toBe(0);
    expect(fm!.to).toBe(doc.length); // swallowed the rest of the document
    // Only the opening fence produced a mark; there is no closing fence.
    expect(nodesNamed(state, "FrontmatterMark")).toHaveLength(1);
  });

  it("accepts `...` as a closing fence variant", () => {
    // YAML permits `...` as a document-end marker; the parser supports it too.
    const doc = "---\ntitle: Hello\n...\nbody";
    const state = parse(doc);
    const fm = frontmatter(state);
    expect(fm).toBeDefined();
    expect(fm!.from).toBe(0);
    expect(fm!.to).toBe(doc.indexOf("\nbody"));
    expect(state.sliceDoc(fm!.from, fm!.to)).toBe("---\ntitle: Hello\n...");
    // The closing `...` is recorded as a FrontmatterMark.
    const marks = nodesNamed(state, "FrontmatterMark");
    expect(marks.length).toBe(2);
    const dotsAt = doc.indexOf("...");
    expect([marks[1].from, marks[1].to]).toEqual([dotsAt, dotsAt + 3]);
  });

  it("does NOT treat a `---` that is preceded by text as Frontmatter", () => {
    // `---` only matters at the very top. Here a paragraph comes first, so the
    // `---` is an ordinary thematic break / setext underline — never frontmatter.
    const doc = "intro paragraph\n---\nkey: value\n---\nbody";
    const state = parse(doc);
    expect(frontmatter(state)).toBeUndefined();
    expect(nodesNamed(state, "FrontmatterMark")).toHaveLength(0);
  });

  it("does NOT treat a `---` after a blank first line as Frontmatter", () => {
    // The opening fence must be on line 1 at offset 0; a leading blank line means
    // the document does not START with `---`, so no preamble is recognized.
    const doc = "\n---\nkey: value\n---\nbody";
    const state = parse(doc);
    expect(frontmatter(state)).toBeUndefined();
  });

  it("does not start frontmatter when the first line is not exactly `---`", () => {
    // A fence-like-but-longer rule (`----`) is a thematic break, not the YAML
    // fence the parser keys on (`line.text.trim() === "---"`).
    const doc = "----\nkey: value\n----\nbody";
    const state = parse(doc);
    expect(frontmatter(state)).toBeUndefined();
  });
});
