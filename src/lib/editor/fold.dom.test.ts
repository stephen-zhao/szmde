import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { foldCode, foldable, foldedRanges, forceParsing } from "@codemirror/language";
import { editorExtensions } from "./setup";
import type { RenderMode } from "./render-mode";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function build(doc: string, mode: RenderMode = "clean"): EditorView {
  const v = new EditorView({
    state: EditorState.create({ doc, extensions: editorExtensions(true, mode) }),
    parent: document.body,
  });
  forceParsing(v, doc.length, 5000);
  view = v;
  return v;
}
const foldableAtLine = (v: EditorView, n: number) => {
  const l = v.state.doc.line(n);
  return foldable(v.state, l.from, l.to);
};
function foldLine(v: EditorView, n: number) {
  v.dispatch({ selection: { anchor: v.state.doc.line(n).from } });
  foldCode(v);
}
const countFolded = (v: EditorView) => {
  let c = 0;
  foldedRanges(v.state).between(0, v.state.doc.length, () => {
    c++;
  });
  return c;
};

describe("[REQ-FOLD-1] heading folding", () => {
  it("a heading with a body is foldable, and the chevron is only on heading lines", () => {
    const v = build("# A\nbody\nmore");
    expect(foldableAtLine(v, 1)).toBeTruthy(); // the heading section folds
    // lang-markdown allows fold-from-any-line, but the chevron affordance is
    // restricted to heading lines — exactly one here, not on the body lines.
    expect(v.contentDOM.querySelectorAll(".cm-fold-chevron").length).toBe(1);
  });

  it("folds from the heading-line end through the section, hiding the body", () => {
    const v = build("# A\nbody line\nmore");
    foldLine(v, 1);
    expect(countFolded(v)).toBe(1);
    expect(v.contentDOM.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    expect(v.contentDOM.textContent).not.toContain("body line");
    expect(v.contentDOM.textContent).toContain("A"); // heading stays visible
  });

  it("bounds the section at the next same-or-higher heading", () => {
    const v = build("# A\nbody\n# B\nother");
    expect(foldableAtLine(v, 1)!.to).toBe(v.state.doc.line(2).to);
  });

  it("includes a deeper nested heading inside the section", () => {
    const v = build("# A\nintro\n## sub\ndeep\n# B");
    expect(foldableAtLine(v, 1)!.to).toBe(v.state.doc.line(4).to);
  });

  it("a heading with no body is not foldable", () => {
    expect(foldableAtLine(build("# A\n# B"), 1)).toBeNull();
    expect(foldableAtLine(build("# only"), 1)).toBeNull();
  });

  it("does not treat a '#' line inside a fenced code block as a heading", () => {
    const v = build("# real\ntext\n```\n# not a heading\n```\nmore");
    expect(foldableAtLine(v, 4)).toBeNull(); // the '#' inside the fence
    expect(foldableAtLine(v, 1)!.to).toBe(v.state.doc.line(6).to); // section spans the fence
  });

  it("renders a chevron on each foldable heading line", () => {
    const v = build("# A\nbody");
    expect(v.contentDOM.querySelector(".cm-fold-chevron")).not.toBeNull();
  });

  it("[REQ-FOLD-2] renders the chevron as a button (role + aria-expanded) in every mode", () => {
    for (const mode of ["clean", "markers-rendered", "markers-syntax"] as RenderMode[]) {
      const v = build("# A\nbody", mode);
      const chev = v.contentDOM.querySelector(".cm-fold-chevron")!;
      expect(chev.getAttribute("role")).toBe("button");
      expect(chev.getAttribute("aria-label")).toBe("Fold section");
      expect(chev.getAttribute("aria-expanded")).toBe("true"); // unfolded
      v.destroy();
    }
    view = undefined;
  });

  it("clicking the chevron folds the section", () => {
    const v = build("# A\nbody line");
    const chev = v.contentDOM.querySelector(".cm-fold-chevron")!;
    chev.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(countFolded(v)).toBe(1);
  });

  it("updates the chevron when a selection move silently clears the fold", () => {
    // CM's clearTouchedFolds unfolds (no fold effect) when a selection lands in a
    // folded body — e.g. a Find match. The chevron must track that, not go stale.
    const v = build("# A\naaaa\nbbbb\ncccc\n# B\ndddd");
    foldLine(v, 1);
    expect(countFolded(v)).toBe(1);
    expect(v.contentDOM.querySelector(".cm-fold-chevron")?.textContent).toBe("▸"); // folded
    v.dispatch({ selection: EditorSelection.single(v.state.doc.line(3).from) }); // into A's body
    expect(countFolded(v)).toBe(0); // fold silently cleared
    expect(v.contentDOM.querySelector(".cm-fold-chevron")?.textContent).toBe("▾"); // chevron synced
  });

  it("folds identically across all render modes", () => {
    for (const mode of ["clean", "markers-rendered", "markers-syntax"] as RenderMode[]) {
      const v = build("# A\nbody", mode);
      foldLine(v, 1);
      expect(countFolded(v)).toBe(1);
      v.destroy();
    }
    view = undefined;
  });
});
