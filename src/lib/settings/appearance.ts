import type { AppearanceSettings, LineWidth } from "./schema";

// Reading-column widths for the lineWidth enum. `medium` is today's hard-coded
// 740px (so the default is visually unchanged). Wired via the --reading-width
// var that theme.ts's .cm-content max-width reads.
const LINE_WIDTH_PX: Record<LineWidth, string> = {
  narrow: "640px",
  medium: "740px",
  wide: "880px",
};

// Fallback stack appended after the user's chosen family so we never lose the
// system fallbacks (matches the original --font-body value for "Inter").
const FONT_FALLBACK = `-apple-system, "Segoe UI", system-ui, sans-serif`;

/**
 * Apply appearance settings to CSS custom properties on `target` (normally
 * document.documentElement). Pure DOM write — no reads, no framework — so it's
 * unit-testable against any element and reused by the Svelte adapter's $effect.
 * The editor picks these up automatically because theme.ts already reads the
 * vars via `var(--…)`, so no editor reconfiguration is needed.
 */
export function applyAppearance(target: HTMLElement, a: AppearanceSettings): void {
  const s = target.style;
  s.setProperty("--editor-font-size", `${a.fontSize}px`);
  s.setProperty("--accent", a.accentColor);
  s.setProperty("--font-body", `"${a.fontFamily}", ${FONT_FALLBACK}`);
  s.setProperty("--reading-width", LINE_WIDTH_PX[a.lineWidth]);
  // color-scheme drives native UI; data-theme is the hook for the future light
  // palette (only the dark palette exists today — light/system land in M5).
  s.setProperty("color-scheme", a.theme === "system" ? "light dark" : a.theme);
  target.setAttribute("data-theme", a.theme);
}
