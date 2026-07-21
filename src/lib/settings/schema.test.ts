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

describe("[REQ-SCROLL-1] typewriterScrolling setting", () => {
  it("is ON by default", () => {
    // The requirement is "by default, keep the active line centred" — the editor seeds
    // itself from this value on load (+page.svelte), so the default IS the behaviour.
    expect(DEFAULTS.editor.typewriterScrolling).toBe(true);
  });

  it("only accepts booleans, falling back to the default", () => {
    const withBad = { ...DEFAULTS, editor: { ...DEFAULTS.editor, typewriterScrolling: "yes" } };
    expect(validate(withBad).editor.typewriterScrolling).toBe(true);

    const off = { ...DEFAULTS, editor: { ...DEFAULTS.editor, typewriterScrolling: false } };
    expect(validate(off).editor.typewriterScrolling).toBe(false);
  });
});
