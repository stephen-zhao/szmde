import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { editorExtensions } from "./setup";
import { setTypewriter, typewriterEnabled } from "./typewriter";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

/**
 * happy-dom reports 0 for every layout box, so `scrollDOM.clientHeight` is 0 unless we
 * stub it. That is itself worth asserting (the unmeasured-viewport guard), and stubbing
 * lets us exercise the real facet callback for a measured one.
 */
function build(typewriter = true, scrollerHeight?: number): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc: "line one\nline two\nline three",
      extensions: editorExtensions(true, "clean", { style: "spaces", width: 2 }, true, undefined, typewriter),
    }),
    parent: document.body,
  });
  if (scrollerHeight !== undefined) {
    Object.defineProperty(v.scrollDOM, "clientHeight", {
      configurable: true,
      get: () => scrollerHeight,
    });
  }
  view = v;
  return v;
}

/** Sum the margins the way CodeMirror does when it scrolls something into view. */
function bottomMargin(v: EditorView): number {
  return v.state
    .facet(EditorView.scrollMargins)
    .map((f) => f(v))
    .reduce((acc, m) => acc + (m?.bottom ?? 0), 0);
}

describe("[REQ-SCROLL-1] typewriter scrollMargins extension", () => {
  it("reserves half the measured viewport below the caret when enabled", () => {
    const v = build(true, 800);
    expect(bottomMargin(v)).toBe(400);
  });

  it("reserves nothing when the setting is off", () => {
    const v = build(false, 800);
    expect(bottomMargin(v)).toBe(0);
  });

  it("reserves nothing while the viewport is unmeasured (clientHeight 0)", () => {
    const v = build(true); // no stub -> happy-dom reports 0
    expect(bottomMargin(v)).toBe(0);
  });

  it("setTypewriter reconfigures a live editor in both directions", () => {
    const v = build(true, 600);
    expect(v.state.facet(typewriterEnabled)).toBe(true);
    expect(bottomMargin(v)).toBe(300);

    setTypewriter(v, false);
    expect(v.state.facet(typewriterEnabled)).toBe(false);
    expect(bottomMargin(v)).toBe(0);

    setTypewriter(v, true);
    expect(v.state.facet(typewriterEnabled)).toBe(true);
    expect(bottomMargin(v)).toBe(300);
  });

  it("tracks a viewport that shrinks — e.g. the Android soft keyboard (M6 S3)", () => {
    // --kb-inset shrinks .app from 952 to 579 when the keyboard opens; the margin must
    // follow, or the caret would be centred on a viewport that no longer exists.
    const v = build(true, 952);
    expect(bottomMargin(v)).toBe(476);
    Object.defineProperty(v.scrollDOM, "clientHeight", { configurable: true, get: () => 579 });
    expect(bottomMargin(v)).toBe(290);
  });
});
