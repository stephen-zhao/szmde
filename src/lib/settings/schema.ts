import { MODE_ORDER, type RenderMode } from "../editor/render-mode";
import type { Eol } from "../editor/eol";

/**
 * The szmde settings schema (SPEC §8). Two tiers (system + user) are deep-merged
 * over these DEFAULTS to form the effective settings. DEFAULTS is the single
 * source of truth and doubles as the validation whitelist (validate.ts): only
 * keys present here are ever read, and each leaf has a guard below.
 *
 * DEFAULTS deliberately mirror the shipped app.css / editor literals so the
 * effective settings equal today's visuals before any user customization
 * (asserted in schema.test.ts to catch drift).
 */
export const SCHEMA_VERSION = 1;

export type Theme = "dark" | "light" | "system";
export type LineWidth = "narrow" | "medium" | "wide";
export type IndentStyle = "spaces" | "tab";

export interface AppearanceSettings {
  theme: Theme;
  accentColor: string;
  fontFamily: string;
  fontSize: number;
  lineWidth: LineWidth;
  showStatusWidgets: boolean;
  showWordCount: boolean;
}
export interface EditorSettings {
  renderMode: RenderMode;
  revealMarkersOnCursor: boolean;
  autosave: boolean;
  autosaveIntervalMs: number;
  spellcheck: boolean;
  defaultEol: Eol;
  indentStyle: IndentStyle;
  indentWidth: number;
}
export interface MarkdownSettings {
  flavor: "gfm" | "commonmark";
  renderHtml: boolean;
}
export interface StorageAccount {
  id: string;
  provider: string;
  label: string;
}
export interface StorageSettings {
  defaultProvider: string;
  accounts: StorageAccount[];
}
export interface Settings {
  version: number;
  appearance: AppearanceSettings;
  editor: EditorSettings;
  markdown: MarkdownSettings;
  storage: StorageSettings;
}

/** A deep-partial of Settings (arrays are replaced wholesale, not deep-partialed)
 *  — the shape of an update patch and of a stored override tier. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer _U)[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export const DEFAULTS: Settings = {
  version: SCHEMA_VERSION,
  appearance: {
    theme: "dark",
    accentColor: "#7c9cff",
    fontFamily: "Inter",
    fontSize: 16,
    lineWidth: "medium",
    showStatusWidgets: true,
    // Word/char count chip — off by default (§7.1: status area stays minimal).
    showWordCount: false,
  },
  editor: {
    renderMode: "clean",
    revealMarkersOnCursor: true,
    // Autosave is implemented (M3 S3 / REQ-SAVE-2) but ships OPT-IN: default off,
    // pending a decision to flip it on by default. Set editor.autosave=true to
    // enable. (SPEC §8's illustrative schema shows true.)
    autosave: false,
    autosaveIntervalMs: 2000,
    spellcheck: false,
    defaultEol: "lf",
    indentStyle: "spaces",
    indentWidth: 2,
  },
  markdown: {
    flavor: "gfm",
    renderHtml: false,
  },
  storage: {
    defaultProvider: "local",
    accounts: [],
  },
};

// --- Per-field guards (validate.ts walks DEFAULTS and applies these) ---------
type Guard = (v: unknown) => boolean;
const isBool: Guard = (v) => typeof v === "boolean";
const isNonEmptyString: Guard = (v) => typeof v === "string" && v.length > 0;
const isHexColor: Guard = (v) => typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
const oneOf =
  (allowed: readonly unknown[]): Guard =>
  (v) =>
    allowed.includes(v);
const intInRange =
  (min: number, max: number): Guard =>
  (v) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Leaf guards, grouped to mirror Settings (minus `version` + `storage`, which
 *  validate.ts handles specially). */
export const GUARDS: {
  appearance: Record<keyof AppearanceSettings, Guard>;
  editor: Record<keyof EditorSettings, Guard>;
  markdown: Record<keyof MarkdownSettings, Guard>;
} = {
  appearance: {
    theme: oneOf(["dark", "light", "system"]),
    accentColor: isHexColor,
    fontFamily: isNonEmptyString,
    fontSize: intInRange(8, 72),
    lineWidth: oneOf(["narrow", "medium", "wide"]),
    showStatusWidgets: isBool,
    showWordCount: isBool,
  },
  editor: {
    renderMode: oneOf(MODE_ORDER as readonly RenderMode[]),
    revealMarkersOnCursor: isBool,
    autosave: isBool,
    autosaveIntervalMs: intInRange(250, 600000),
    spellcheck: isBool,
    defaultEol: oneOf(["lf", "crlf"]),
    indentStyle: oneOf(["spaces", "tab"]),
    indentWidth: intInRange(1, 16),
  },
  markdown: {
    flavor: oneOf(["gfm", "commonmark"]),
    renderHtml: isBool,
  },
};
