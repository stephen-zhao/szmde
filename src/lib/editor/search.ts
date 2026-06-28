import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";

/**
 * Find & replace (REQ-FR-1) via `@codemirror/search`: a themed top panel,
 * **literal-by-default** (regex / case / whole-word are toggles in the panel),
 * operating directly on the raw markdown document text (so it behaves identically
 * in all three render modes — markers are visual only).
 *
 * `searchKeymap` (Mod-f open, Mod-g / Shift-Mod-g next/prev, replace bindings,
 * Escape close) is added at **high precedence** so Mod-f beats the default keymap;
 * Mod-f is otherwise unbound (the page handles only Ctrl+S/O/N; editingKeymap has
 * Mod-b/i, Mod-Shift-m). Selecting a match places a non-empty selection whose
 * endpoints the markers reveal-on-cursor logic already consumes, so a match inside
 * a hidden Clean-mode marker reveals automatically — no extra code.
 */
export const searchExtension: Extension = [
  search({ top: true, literal: true, caseSensitive: false }),
  Prec.high(keymap.of(searchKeymap)),
];
