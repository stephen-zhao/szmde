# M1 — WYSIWYG Live-Preview Engine (implementation plan)

_Implementation plan for milestone **M1** (see [SPEC.md](../SPEC.md) §10 for the
milestone definition and §4 for the behavior). SPEC.md is the "what"; this doc is the
"how" — the architecture and the staged build sequence (the `S1…S6` slices)._

_Status legend: ✅ done · 🔜 next · ⬜ planned._

## Scope (from SPEC §4 / §10 "M1")

1. The **three render modes** (SPEC §4.1): Clean (markers hidden, reveal-on-cursor),
   Markers-rendered (markers styled like the text), Markers-syntax (markers as greyed
   tokens). Quick toggle `Ctrl/Cmd+Shift+M` + hamburger menu.
2. Live-preview of the v1 **inline + basic-block** constructs: headings, bold, italic,
   strikethrough, inline code, blockquote, unordered/ordered lists, links. (Code blocks
   already done in M0. Tables / task lists / images / GFM alerts are **M2**.)
3. **Markdown shortcuts** (SPEC §4.2): typing syntax formats live; accelerators
   `Ctrl/Cmd+B`/`Ctrl/Cmd+I`; Enter continues lists/quotes; smart outdent.
4. **EOL + indentation** behavior and the bottom-right **status widgets** (SPEC §4.4 / §7.1).
5. **Performance** (SPEC §4.3): keystroke-to-paint < 16 ms; viewport-only decoration.

## Architecture (verified against the installed CodeMirror 6 source)

- **Render mode** is a `Facet` behind a `Compartment` (mirrors the M0 code-wrap default).
  No per-position data → no StateField. Persisted across `setState` document loads by
  re-seeding it in `Editor.svelte`'s `buildState`. → `src/lib/editor/render-mode.ts`
- **Two decoration ViewPlugins**, kept separate so each `RangeSetBuilder` only needs to be
  internally sorted (avoids line-vs-inline sort coupling):
  - `blockLineDecorations` (M0, extended in S4) — `Decoration.line` for heading/quote/list
    line paint (bars, spacing, bullets, indent).
  - `markerDecorations` (new) — `Decoration.replace` (hide) / `Decoration.mark` (style) for
    the syntax markers, per render mode. → `src/lib/editor/markers.ts`
- **Hiding markers** uses `Decoration.replace`; arrow-key skipping needs the same ranges fed
  to `EditorView.atomicRanges` (a separate "hidden" RangeSet). Modes 2/3 contribute no
  hidden ranges, so markers stay freely navigable real text.
- **Reveal-on-cursor** (Clean mode only) = "don't hide the construct the caret is in." The
  marker plugin rebuilds on `selectionSet` only in Clean mode; revealed ranges come from
  `syntaxTree.resolveInner` at each selection endpoint.
- **Coexistence with M0**: the wrap `StateField`, `BlockWrapper` code boxes, the
  code-box reveal plugin, and frontmatter decorations are untouched. Marker handling skips
  any node under `FencedCode`.
- **Performance**: both walks iterate `view.visibleRanges` only; selection-driven rebuilds
  are gated to Clean mode; the M0 `syntaxTree` parse-change guard drives minimal rebuilds.

## Staged build sequence

### S1 — Render-mode state + toggle + reporting ✅
Facet/Compartment, `Ctrl/Cmd+Shift+M` cycle, `EditorApi.setRenderMode/getRenderMode`,
`onrendermode` reporting, hamburger radio group, persistence across loads.
**Verify:** Ctrl+Shift+M cycles the menu's checked mode; survives opening a file. (No
visual change yet — infrastructure only.)

### S2 — Inline marker hide/style across the 3 modes ✅
`markerDecorations`: Clean hides markers (`Decoration.replace`); Markers-syntax greys them
(`cm-md-mark-syntax`); Markers-rendered styles them like their text (`cm-mk-strong/em/strike/code`).
Keyed on the parent construct; fenced-code marks skipped; ordered-list ordinals always shown.
Syntax markers use an **absolute** small size (`calc(var(--editor-font-size) * 0.75)`) so a
heading's marker is the same small size as a paragraph's, not enlarged.
Unordered-list markers are **not** hidden in Clean mode — they render a decorative `•`
(`BulletWidget`), since list markers are semantic, not pure syntax. (Bullet *layout/indent* and
quote bars remain S4.)
**Verify:** type `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `# H`, `- item` and cycle modes.

### S3 — Reveal-on-cursor + atomicRanges ✅
`markerDecorations` now emits a separate `hidden` RangeSet → `markerAtomicRanges`
(`EditorView.atomicRanges`) so arrows skip hidden markers and one delete removes a whole
marker. Rebuilds on `selectionSet` in Formatted mode only. Reveal: block marks (heading/quote)
reveal on the caret's line; inline marks reveal when a caret is within their construct
(all ancestor constructs; touch-based at edges). Bullets/ordered-numbers stay shown.
**Verify:** caret into a bold span un-hides its `**` for editing; arrows skip hidden markers;
deleting the closing `**` un-bolds live; leaving the construct re-hides.

### S4 — Block constructs (headings / blockquote / lists) ✅
New `blocks.ts` (`blockConstructDecorations`): heading line spacing (`cm-h1`..`cm-h6`, padding
only) and a blockquote left bar (`cm-blockquote`, border-left + padding). Uses a per-line
class Map → sorted emit, so nested blocks (heading in a quote) combine cleanly. List bullets/
numbers already render (S2) and nesting comes from the literal leading spaces.
**Verify:** quotes show a continuous left bar with `>` hidden in Formatted; headings have
breathing room; caret stays aligned (padding-only).
_Deferred: list-item hanging indent for wrapped lines; setext (underline) headings; nested
blockquote depth bars (single bar in M1)._

### S5 — Input shortcuts (B / I / Tab) ✅
New `keymap.ts`: `toggleBold`/`toggleItalic` (Mod-b/Mod-i) wrap/unwrap via `changeByRange` +
`wordAt` + syntax-tree detection, inert in code (logic unit-verified in Node). `Tab` inserts
soft tabs (custom command — `insertTab` inserts a literal `\t`, so we use `indentString`/
`getIndentUnit`) or indents the selection; on an **empty list item** (marker + space only) Tab
instead increases the item's nesting (`indentMore`); `Shift-Tab` = `indentLess`. `indentUnit` =
2 spaces.
Render-mode cycle (Mod-Shift-m) consolidated here at `Prec.high`. The markdown keymap is
re-added EXPLICITLY at `Prec.high` (lang-markdown `addKeymap: false` in setup.ts) so its Enter
binding beats the default keymap's plain newline: **Enter** → continue the list/quote (new
bullet, incremented ordinal, exit on empty item — `insertNewlineContinueMarkup`, behavior
unit-verified); **Shift+Enter** → continuation line (newline + indent) with no new marker.
Backspace = markup-aware delete.
Enter on an **empty top-level list item** exits the list cleanly (custom `listEnterOrExit`
wraps `insertNewlineContinueMarkup`, since the latter leaves a stray blank-line+bullet there).
**Verify (now covered by automated tests — see Testing):** Ctrl+B on a word wraps `**…**` and
toggles off; Ctrl+I likewise; Enter in a list makes a new bullet (numbers increment); Enter on
an empty item exits; Shift+Enter indents without a bullet; Tab inserts 2 spaces; Ctrl+B inside
code does nothing.

## Testing (TDD from here on)

Vitest + happy-dom. `src/lib/editor/editing.test.ts` constructs a **real `EditorView`** with the
full `editorExtensions()` and dispatches real key events — so it exercises the **integrated
keymap precedence**, which is where list/Enter behavior kept regressing (testing commands in
isolation missed it). Run with `npm run test` (or `npm run test:watch`). Going forward: write a
failing test that captures the intended behavior **before** changing the implementation. A
project-wide 100%-coverage policy is planned later; for now, cover editor behaviors as we build.

### S6 — EOL + indentation + status widgets ⬜
EOL default LF, toggle LF↔CRLF rewrites the doc + writes chosen EOL on save; detect on open.
Tab-inserts-spaces (`indentUnit`), width config, Spaces↔Tab toggle, convert-existing action.
Two bottom-right click-to-edit chips. → `src/lib/editor/indent.ts`, status chips in `+page.svelte`.
**Verify:** open a CRLF file → chip reads CRLF; toggle to LF → save writes LF; indent chip
switches Spaces/Tab and width live.

## New / changed files

- **New:** `src/lib/editor/render-mode.ts` ✅, `src/lib/editor/markers.ts` ✅,
  `src/lib/editor/keymap.ts` (S5), `src/lib/editor/indent.ts` (S6).
- **Changed:** `setup.ts` (thread mode + plugins) ✅, `theme.ts` (marker + block CSS) ✅(partial),
  `Editor.svelte` (API + reporting) ✅, `+page.svelte` + `HamburgerMenu.svelte` (menu, chips) ✅(S1).

## Decisions taken (defaults — overridable)

| # | Decision | Default chosen |
|---|----------|----------------|
| Default render mode | what the app opens in | **Clean** (pure WYSIWYG) |
| Links in Clean mode | click behavior | **Ctrl/Cmd+click opens**; plain click = caret (S4/links) |
| Render-mode persistence | save to settings? | **Ephemeral per window** for M1; settings persistence in M2 |
| Markers-rendered fidelity | markers muted vs identical | **Explicit re-style** so `**` truly looks bold |
| Reveal scope | innermost vs ancestors | **All ancestor inline constructs under the caret + block marks on its line** |
| Reveal trigger | touch vs strictly-inside | **Touch-based** (selection endpoints, side ±1) |
| EOL undo | in CM history vs re-toggle | **Re-toggle** (LF buffer never changes) |
| Blockquote bars | single vs depth-stacked | **Single bar** in M1; depth bars → M2 |
| Default indent | width | **2 spaces**; Tab inserts spaces |

## Deferred refinements (within M1 / later)

- **Markers-syntax block-marker hanging indent.** In markers-syntax mode, block-level leading
  markers should hang in the left margin (negative indent), to the left of the text column, so
  the content stays flush at the margin (not pushed inward):
  - **headings** (`#`, `##`, …) — trailing space also in the gutter so heading text starts at
    the margin;
  - **blockquotes** (`>`) — the `>` markers also sit left of the left-margin line, keeping
    quoted text aligned.

  Likely a per-line padding/text-indent on heading/quote lines gated on markers-syntax mode
  (mind the M0 cursor-alignment lesson — padding/indent, no margins). _(Requested during S2/S4;
  deferred.)_

## Risks (carried from design)

1. Shared mark-node names (`EmphasisMark`, `CodeMark`) → always key on the **parent** node.
2. Cursor/height-map desync from block spacing → **padding/border only, never margin** (M0 lesson).
3. Double bullet if the `::before` isn't mode-gated → gate on the `cm-clean` content class.
4. Hidden markers without `atomicRanges` → arrow keys pause in zero-width gaps (fixed in S3).
