import { describe, expect, it } from "vitest";
import { DEFAULTS, SCHEMA_VERSION } from "./schema";
import { validate } from "./validate";

describe("[REQ-SET-2] schema DEFAULTS", () => {
  it("passes validate() unchanged (DEFAULTS is itself valid)", () => {
    expect(validate(DEFAULTS)).toEqual(DEFAULTS);
  });

  it("is stamped at the current schema version", () => {
    expect(DEFAULTS.version).toBe(SCHEMA_VERSION);
  });

  it("matches the shipped app.css / editor literals (settings === visuals on day one)", () => {
    // If app.css or the editor defaults change, update both so settings stay in sync.
    expect(DEFAULTS.appearance.accentColor).toBe("#7c9cff"); // app.css --accent
    expect(DEFAULTS.appearance.fontSize).toBe(16); // app.css --editor-font-size
    expect(DEFAULTS.appearance.fontFamily).toBe("Inter"); // app.css --font-body lead
    expect(DEFAULTS.appearance.lineWidth).toBe(740); // px == theme.ts 740px max-width
    expect(DEFAULTS.appearance.theme).toBe("dark");
    expect(DEFAULTS.editor.renderMode).toBe("clean");
    expect(DEFAULTS.editor.defaultEol).toBe("lf");
    expect(DEFAULTS.editor.indentStyle).toBe("spaces");
    expect(DEFAULTS.editor.indentWidth).toBe(2);
  });
});

describe("[REQ-SCROLL-1] typewriter settings", () => {
  it("is ON by default", () => {
    // The requirement is "by default, keep the active line off the bottom edge" — the
    // editor seeds itself from this value on load (+page.svelte), so the default IS the
    // behaviour.
    expect(DEFAULTS.editor.typewriterScrolling).toBe(true);
  });

  it("rests the line two thirds down by default", () => {
    // Centring (0.5) shipped first and user testing on a phone rejected it as too
    // high; 2/3 keeps more written context above the cursor.
    expect(DEFAULTS.editor.typewriterAnchor).toBeCloseTo(2 / 3, 5);
  });

  it("bounds the anchor to a sane fraction, falling back to the default", () => {
    const anchored = (typewriterAnchor: unknown) =>
      validate({ ...DEFAULTS, editor: { ...DEFAULTS.editor, typewriterAnchor } }).editor
        .typewriterAnchor;
    expect(anchored(0.5)).toBe(0.5);
    expect(anchored(0.9)).toBe(0.9);
    // Out of range, wrong type, or non-finite -> the default stands. An anchor at or
    // below 0 asks for a resting point above the top edge; 1+ is off the bottom.
    for (const bad of [0, 0.05, 1, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null]) {
      expect(anchored(bad)).toBeCloseTo(2 / 3, 5);
    }
  });

  it("only accepts booleans for the toggle, falling back to the default", () => {
    const withBad = { ...DEFAULTS, editor: { ...DEFAULTS.editor, typewriterScrolling: "yes" } };
    expect(validate(withBad).editor.typewriterScrolling).toBe(true);

    const off = { ...DEFAULTS, editor: { ...DEFAULTS.editor, typewriterScrolling: false } };
    expect(validate(off).editor.typewriterScrolling).toBe(false);
  });
});
