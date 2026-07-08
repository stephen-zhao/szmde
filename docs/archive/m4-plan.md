# M4 — Authoring essentials (implementation plan)

> **📦 Archived — historical planning artifact.** This milestone has shipped; the plan below is
> preserved as **provenance** (why the code is shaped the way it is), **not** current-state tracking.
> For current status see [roadmap.md](../roadmap.md) · [requirements.md](../requirements.md) ·
> [bugs.md](../bugs.md).

_Implementation plan for milestone **M4** (see [roadmap.md](../roadmap.md) "M4" for the
requirement slotting and [SPEC.md](../../SPEC.md) §5.4 / §7.1 / §7.3 / §4.1 for the behavior).
SPEC.md is the "what"; this doc is the "how" — architecture + staged `S1…S6` slices. Same
shape as [m1-plan.md](m1-plan.md) / [m2-plan.md](m2-plan.md) / [m3-plan.md](m3-plan.md).
Grounded by a 6-agent parallel design scout (2026-06-27)._

_Status legend: ✅ done · 🔜 next · ⬜ planned._

## Scope (from roadmap "M4")

Daily-authoring + reading-experience power-features for the target user. All are
editor-local (no external deps beyond one package) and on-disk content stays portable GFM.

| REQ | Requirement | Slice | Effort |
|-----|-------------|-------|--------|
| REQ-COUNT-1 | Live word / character count in the bottom-right status area | S1 | S |
| REQ-FR-1 | Find & replace (incl. regex) | S2 | S |
| REQ-EMOJI-1 | Emoji shortcodes `:smile:` → rendered glyph (literal stays on disk) | S3 | M |
| REQ-FOLD-1 | Collapsible / foldable sections & headings | S4 | M |
| REQ-ZOOM-1/2 | Ctrl/Cmd+scroll → text size; Shift+scroll → page width | S5 | S |
| REQ-RENDER-9 | Syntax mode: block markers hang in the left margin (overhanging indent) | S6 | S |

## Architecture (extends the established editor layering)

Every slice slots into patterns M1–M3 already established — no new top-level concepts:

- **Pure core + co-located tests** (the `eol.ts` / `count.ts` shape): `count.ts` (word/char),
  `zoom.ts` step helpers, `emoji-data.ts` map — dependency-free, 100%-unit-testable.
- **Decoration plugins** (the `images.ts` / `markers.ts` shape): `emoji.ts` (replace
  `:code:` with a glyph widget in Clean, reveal-on-cursor + atomicRanges, code/URL-guarded);
  `RENDER-9` extends `markers.ts`'s existing `markers-syntax` block-mark branch.
- **Editor extensions registered in `setup.ts`**: `searchExtension` (`@codemirror/search`),
  `foldExtension` (`@codemirror/language` foldService + inline chevron), `zoomGestures`
  (`EditorView.domEventHandlers({wheel})`), `emojiDecorations`.
- **EditorApi push/pull** (the `getRenderMode`/`onrendermode` shape): `getCount()` + `oncount`
  via the existing `updateListener`; `onzoomfont`/`onzoomwidth` push-only callbacks; `setEmoji`.
- **Settings + status-bar + keymap** reuse the M2 service/chip/`editingKeymap` seams.

The editor stays framework-agnostic: new state flows out via callbacks (like
`onrendermode`/`onindentstate`); `+page.svelte` owns settings persistence.

## Decisions taken (from the scout; defaults — overridable)

| # | Decision | Choice |
|---|----------|--------|
| Find/replace impl | library vs hand-rolled | **`@codemirror/search`** default top panel, themed; **literal-by-default** with a regex toggle; `Mod-f` (currently unbound everywhere) |
| Emoji on-disk | literal vs rewrite | **Keep `:smile:` on disk** (portable, GitHub-style); render the glyph via a reveal-on-cursor decoration (Clean only) — never rewrite the buffer |
| Emoji map | bundled vs dependency | **Curated ~200 bundled** shortcodes (`emoji-data.ts`), no dependency; documented swap path to a full set |
| Folding affordance | gutter vs inline | **Inline heading chevron widget** (WrapToggleWidget pattern), **not** a gutter — preserves the centered no-gutter column; headings-only in v1 |
| **Page-width (ZOOM-2)** | enum-step vs numeric | **Shift+scroll steps the `lineWidth` enum** {narrow,medium,wide} — zero schema change, settings stay portable. **Numeric `lineWidth` is a deferred follow-up** (schema guard + appearance map + migration). |
| Zoom font (ZOOM-1) | step/bounds | **Ctrl/Cmd+scroll, 1px steps, clamp 10–32px**; persists to `appearance.fontSize`; reading width stays constant (text wraps sooner) |
| Word count | default on/off | **Off by default** (`appearance.showWordCount`, §7.1); a read-only chip when on; render-mode-independent (counts the raw buffer) |
| RENDER-9 alignment | px vs algorithmic | **`position:absolute; right:100%`** on the marker span (em-based) — each marker's own measured width determines how far it hangs, right-aligned to the margin with **no width constant** |

## Staged build sequence

> Each slice: **failing test(s) first** (TDD, T4), then implementation, `npm run test` +
> `npm run check` green, update [requirements.md](../requirements.md) with the new `REQ-*` and tag
> the tests, then commit. Per the standing preference, run an adversarial review over a
> substantial slice before moving on; live-only behavior gets an `llm-workflow-tests.md` entry.

### S1 — Word / character count ✅  (`REQ-COUNT-1`)
`count.ts`: pure `countText(text): {words, chars}` — chars as Unicode **code points** excluding
line breaks; words via a Unicode-aware regex (apostrophes/hyphens = one word; CJK-as-one-word a
noted limitation). `Editor.svelte`: `getCount()` + `oncount` fired from the `updateListener`
**only on `u.docChanged`** (diffed vs a `lastCount` cache — the cheapness lever), seeded on
mount/`setContent`. `+page.svelte`: a non-interactive `<span class="chip">` in the status bar,
gated on a new `appearance.showWordCount` (default **false**) + the existing `showStatusWidgets`.
**Tests** (`count.test.ts`): empty/whitespace, prose, apostrophes/hyphens, emoji=1 char, line
breaks excluded, marker text counted (render-mode independence).

### S2 — Find & replace ✅  (`REQ-FR-1`)
Add `@codemirror/search`. `search.ts`: `search({top:true, literal:true})` + `Prec.high` `Mod-f`
→ `openSearchPanel`, Escape → close, find/replace bindings; register in `setup.ts`. Theme the
default panel in `theme.ts` with the existing CSS vars. Matches run on `state.doc` (raw GFM);
selecting a match reuses `markers.ts` reveal-on-cursor (it already keys off `selection.ranges`
endpoints) so a match inside a hidden Clean-mode marker reveals automatically.
**Tests** (`search.dom.test.ts`): panel open/close; `findNext`/`replaceNext`/`replaceAll`
move/mutate `state.doc`; regex + case + whole-word; match inside a hidden marker reveals.
Live panel UX → workflow.

### S3 — Emoji shortcodes ✅  (`REQ-EMOJI-1`)
`emoji-data.ts` (curated frozen `EMOJI` map) + `emoji.ts` modeled on `images.ts`: `EmojiWidget`,
`buildEmojiDecos` (regex `/:([a-z0-9_+-]+):/gi` over visible ranges; skip unknown codes + matches
inside `InlineCode`/`FencedCode`/`URL`/`Autolink` + caret/selection ranges; **Clean mode only**),
`emojiDecorations` ViewPlugin + `emojiAtomicRanges`, gated by a new `markdown.emoji` (default
true) via a Facet+compartment (`setEmoji` on the EditorApi, seeded from settings).
**Tests** (`emoji.dom.test.ts` + `emoji.test.ts`): map shape; glyph in Clean; reveal-on-cursor;
unknown stays literal; `:foo:` in code/fenced stays literal; Source/Syntax literal; disabled →
none; atomic non-empty; widget DOM reuse.

### S4 — Foldable sections & headings ✅  (`REQ-FOLD-1`)
`fold.ts`: a heading-aware `foldService` (fold from a heading's line-end through the line before
the next same-or-higher heading; `null` if empty → no affordance), `codeFolding({placeholderDOM})`,
and an **inline chevron** fold-toggle widget on foldable heading lines (WrapToggleWidget pattern:
`mousedown` preventDefault → `foldEffect`/`unfoldEffect`), **not** a gutter. `Mod-.` toggle in
`editingKeymap`. Headings-only in v1; fold state session-only (reset by `setContent`).
**Tests** (`fold.dom.test.ts`): fold range bounds (same-or-higher heading; nested deeper stays
folded; EOF; empty-body → not foldable; off-by-one excludes the next heading line); placeholder
present + body removed; identical across render modes; toggle flips. Live affordance → workflow.

### S5 — Zoom + page width ✅  (`REQ-ZOOM-1`, `REQ-ZOOM-2`)
`zoom.ts`: `zoomGestures(cfg)` = `EditorView.domEventHandlers({wheel})` — `Ctrl/Cmd+wheel` →
`onZoomFont(±1)`, `Shift+wheel` → `onZoomWidth(±1)`, plain wheel → passthrough; `preventDefault`
only when handled; one step per event (`-Math.sign(deltaY)`). Pure `stepFontSize(cur,steps,10,32)`
+ `stepLineWidth(cur,steps)` (enum-index clamp). `Editor.svelte` push-only `onzoomfont`/
`onzoomwidth`; `+page.svelte` does the setting math + a ~150ms debounced persist via the service;
CSS vars apply automatically.
**Tests** (`zoom.test.ts`): handler modifier routing (ctrl/meta/shift/none, deltaY=0 no-op,
preventDefault-only-when-handled) via synthetic events; `stepFontSize` clamp; `stepLineWidth`
enum clamp. Live scroll feel + persistence → workflow.

### S6 — Syntax-mode marker gutter ✅  (`REQ-RENDER-9`/`-10`/`-12`)
> **Superseded across M4 feedback rounds.** The original plan (a `position:absolute;
> right:100%` `.cm-md-mark-hang`) top-floated the marker (B1) and, in later attempts, a
> negative `margin-left` stranded the native caret at the margin in WebView2. The SHIPPED
> design is a per-LINE `text-indent` (see [requirements.md](../requirements.md) REQ-RENDER-9
> and [bugs.md](../bugs.md) BUG-CARET-MARGIN), inside a 3-column layout (REQ-RENDER-12).

In `markers.ts`, `handleShownBlockLine` (shared by Syntax mode + Formatted reveal) greys the
whole leading block-marker prefix (`#…`/`>`(s) + spaces, matched by `BLOCK_PREFIX`) with one
`Decoration.mark` (`cm-md-mark-syntax`) and pulls the line left by the prefix's canvas-measured
width via a `Decoration.line` `text-indent` — which moves the line's inline ORIGIN so the caret
follows the glyph into the gutter in every engine. `theme.ts` reserves the chevron + marker
columns as `.cm-content` left padding; the fold chevron is `position:absolute` in its own column
(`.cm-foldhead{position:relative}` anchors it). Chars stay real/selectable (modes-2&3 rule);
re-measured on font change (`remeasureOnFontChange`). Headings + blockquotes only.
**Tests** (`markers.dom.test.ts`): line `text-indent` present + joined prefix syntax text
`"# "`/`"### "`/`"> > "` (and indented `"   # "`, no content-`#` over-match) in Syntax/reveal;
chars in-flow (no widget-buffer, zero atomic) + cursor-glide step-through; NO hang in
Clean-off-line/Source; setext underline stays a plain token. Live gutter/flush/caret-in-gutter
+ columns + no-clip → WF-24.

## New / changed files (anticipated)

- **New:** `src/lib/editor/{count,search,emoji,emoji-data,fold,zoom}.ts` + co-located tests.
- **Changed:** `setup.ts` (register search/fold/zoom/emoji), `markers.ts` (RENDER-9),
  `theme.ts` (search panel, emoji, fold chevron/placeholder, hang CSS), `Editor.svelte`
  (getCount/oncount, setEmoji, onzoom* ), `+page.svelte` (count chip, zoom wiring, emoji seed),
  `keymap.ts` (fold), `settings/schema.ts` (`appearance.showWordCount`, `markdown.emoji`),
  `package.json` (`@codemirror/search`), `requirements.md`, `llm-workflow-tests.md`.

## New deps / settings
- **Dep:** `@codemirror/search@^6` (S2 only).
- **Settings:** `appearance.showWordCount: boolean = false` (S1); `markdown.emoji: boolean = true`
  (S3). Both additive — `validate.ts` fills missing from DEFAULTS, no migration needed.

## Risks
1. **Word-count perf** — gate recompute on `docChanged` + `lastCount` diff (same cost profile as
   existing per-edit `wrapStateOf`/`indentConfigOf`); a large-doc debounce is a no-API-change
   follow-up if needed.
2. **Emoji regex false positives** (`:` in URLs/times) — require `[a-z0-9_+-]+` between colons
   AND a successful map lookup AND not-in-code/URL; worst case a literal the user can reveal.
3. **Fold off-by-one** (pulling the next heading onto the folded line) — `to = doc.line(next-1).to`,
   explicit tests (the alert/HR off-by-one lesson).
4. **Fold affordance vs centered column** — inline chevron, not a gutter (a gutter breaks the
   symmetric `scrollbar-gutter` centering).
5. **Zoom wheel-delta variance** across devices — one step per event via `Math.sign`; debounce
   the persist; `preventDefault` must suppress WebView2 native page-zoom (verify live).
6. **RENDER-9 deep markers at large fonts** could exceed the gutter and clip — markers are 0.75em;
   acceptable for v1, flagged for the live check.
