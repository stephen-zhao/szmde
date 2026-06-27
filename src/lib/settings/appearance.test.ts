import { afterEach, describe, expect, it } from "vitest";
import { applyAppearance } from "./appearance";
import { DEFAULTS } from "./schema";

// happy-dom gives us a real element whose inline CSS custom properties + attrs we
// can read back. applyAppearance is a pure DOM write, so this fully exercises it.
let el: HTMLElement | undefined;
afterEach(() => {
  el?.remove();
  el = undefined;
});
function target(): HTMLElement {
  el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("[REQ-SET-3] applyAppearance — appearance settings → CSS variables", () => {
  it("maps the DEFAULTS appearance to the expected CSS vars", () => {
    const t = target();
    applyAppearance(t, DEFAULTS.appearance);
    expect(t.style.getPropertyValue("--editor-font-size")).toBe("16px");
    expect(t.style.getPropertyValue("--accent")).toBe("#7c9cff");
    expect(t.style.getPropertyValue("--reading-width")).toBe("740px"); // medium
    expect(t.style.getPropertyValue("--font-body")).toContain('"Inter"');
    expect(t.style.getPropertyValue("--font-body")).toContain("sans-serif"); // fallback kept
    expect(t.style.getPropertyValue("color-scheme")).toBe("dark");
    expect(t.getAttribute("data-theme")).toBe("dark");
  });

  it("maps lineWidth enum values to reading-column widths", () => {
    const widths = (lw: "narrow" | "medium" | "wide") => {
      const t = target();
      applyAppearance(t, { ...DEFAULTS.appearance, lineWidth: lw });
      const w = t.style.getPropertyValue("--reading-width");
      t.remove();
      return w;
    };
    expect(widths("narrow")).toBe("640px");
    expect(widths("medium")).toBe("740px");
    expect(widths("wide")).toBe("880px");
  });

  it("uses 'light dark' color-scheme for the system theme", () => {
    const t = target();
    applyAppearance(t, { ...DEFAULTS.appearance, theme: "system" });
    expect(t.style.getPropertyValue("color-scheme")).toBe("light dark");
    expect(t.getAttribute("data-theme")).toBe("system");
  });

  it("reflects a custom accent and font family", () => {
    const t = target();
    applyAppearance(t, { ...DEFAULTS.appearance, accentColor: "#ff0066", fontFamily: "Georgia" });
    expect(t.style.getPropertyValue("--accent")).toBe("#ff0066");
    expect(t.style.getPropertyValue("--font-body")).toContain('"Georgia"');
  });
});
