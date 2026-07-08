import { EditorState, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { search, searchKeymap, SearchQuery, setSearchQuery } from "@codemirror/search";
import { toDollarGroups } from "./replace-groups";

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

/**
 * Capture-group replacement (REQ-FR-2). CM substitutes `$1`-style groups in a
 * regexp replacement but not the backslash form `\1`. This transaction extender
 * rewrites `\1` → `$1` on every search-query update while in regexp mode, so both
 * forms work. It hooks the QUERY (not a command), so it applies uniformly however
 * the replace runs — panel buttons, the keymap, or programmatic. No-ops in literal
 * mode (where `\1` is a literal) and when nothing changed (so it never loops).
 */
const captureGroupReplace = EditorState.transactionExtender.of((tr) => {
  for (const e of tr.effects) {
    if (e.is(setSearchQuery)) {
      const q = e.value;
      if (!q.regexp) return null;
      const replace = toDollarGroups(q.replace);
      if (replace === q.replace) return null;
      return {
        effects: setSearchQuery.of(
          new SearchQuery({
            search: q.search,
            replace,
            caseSensitive: q.caseSensitive,
            literal: q.literal,
            regexp: q.regexp,
            wholeWord: q.wholeWord,
          }),
        ),
      };
    }
  }
  return null;
});

export const searchExtension: Extension = [
  search({ top: true, literal: true, caseSensitive: false }),
  captureGroupReplace,
  Prec.high(keymap.of(searchKeymap)),
];
