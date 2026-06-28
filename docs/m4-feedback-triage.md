# M4 feedback triage

Every comment from the M4 review pass, classified per the process rule:

- **Bug** — behavior that clearly violates an *existing, documented* requirement.
  Fix the behavior; no new requirement needed.
- **New requirement** — desired behavior that wasn't well documented by an existing
  requirement (i.e. a "bug" caused by under-specification). Catalogue a new REQ in
  [traceability.md](traceability.md), then implement it.

Each row links the originating render mode where relevant. "Mode names": Formatted =
`clean`, Source = `markers-rendered`, Syntax = `markers-syntax`.

## Batch 1 — render-mode / fold / toggle

| # | Comment | Class | REQ | Status |
|---|---------|-------|-----|--------|
| B1 | (Syntax) Hung heading `#` / quote `>` must be baseline-aligned with the heading/quote text, not floated to the top | **New req** — REQ-RENDER-9 said the marker hangs but never specified baseline | **REQ-RENDER-10** (new) | ✅ fixed |
| B2 | (Syntax) Hung `#…` must stay in the document flow — arrow-key navigable, mouse-selectable | **Bug** — REQ-RENDER-9 already says "the chars stay real/selectable"; the replace-widget removed them from flow | REQ-RENDER-9 | ✅ fixed |
| B3 | (All) The heading fold arrow is too small/faint; make it a prominent, proper button | **New req** — REQ-FOLD-1 specified "an inline chevron", not its prominence/affordance | **REQ-FOLD-2** (new) | ✅ fixed |
| B4 | (Syntax) Only true syntax-only markers get small-grey; content markers (unordered bullets, ordered numbers) render in normal text style | **Bug** — violates the documented marker-vs-widget rule (a char that IS the rendered widget is not "just syntax"; cf. the task checkbox) | REQ-RENDER-4 | ✅ fixed |
| B5 | Ctrl+Shift+M stopped toggling render mode after being in a blockquote in Formatted mode | **Bug** — REQ-RENDER-7 requires the cycle command to work; it silently died once editor focus drifted to a toolbar control | REQ-RENDER-7 | ✅ fixed (focus-fallback); live confirm pending |
| B6 | (Syntax) Blockquote `>` (and ANY syntax-only marker) must stay in the document flow for cursor navigation | **Bug** — same as B2 (REQ-RENDER-9 "real/selectable") | REQ-RENDER-9 | ✅ fixed |
| B7 | (Formatted) When the cursor reveals a formatted element's markers, render/behave them like Syntax mode (small-grey / hung), not Source literals | **New req** — REQ-RENDER-2 said markers *reveal* on the caret, but never specified the *style* of the revealed marker | **REQ-RENDER-11** (new) | ✅ fixed |

## Batch 2 — find/replace + page width

| # | Comment | Class | REQ | Status |
|---|---------|-------|-----|--------|
| C1 | Find/replace entry boxes are too small to read; make all find/replace text the same, legible size | **New req** — REQ-FR-1 didn't specify input legibility/sizing | **REQ-FR-3** (new) | ✅ fixed |
| C2 | Does find/replace support `\1` backslash capture-group replacement? (If not, it's a gap to add) | **New req** — CM supports `$1` in regexp mode but NOT `\1`; REQ-FR-1 didn't specify capture-group replacement | **REQ-FR-2** (new) | ✅ fixed (`$1` was already native; `\1` added. In regexp mode `\1` normalizes to the canonical `$1` in the replace box — intended) |
| C3 | Shift-scroll page-width range is too small; it should reach the window width, grow/shrink with the window, and cling to the window width when the window shrinks below the current width | **New req** — REQ-ZOOM-2 specified a width gesture but not a window-relative range | **REQ-ZOOM-3** (new) | ✅ fixed (lineWidth enum→px, v1→v2 migration) |

## New requirements added to traceability

- **REQ-RENDER-10** — Syntax-mode (and Formatted-reveal) hung block markers are
  baseline-aligned with the heading/quote text.
- **REQ-RENDER-11** — Formatted-mode reveal-on-cursor renders markers in Syntax
  style (small-grey inline; hung block markers), not Source literals; and they
  stay editable (a mark, never atomic).
- **REQ-FOLD-2** — The heading fold affordance is a prominent button (border/fill,
  `role=button` + `aria-expanded`), consistent across all render modes.
- **REQ-FR-2** — Find/replace supports regex capture-group references in the
  replacement: `$1`-style (CM native) and `\1`-style (translated to `$1`).
- **REQ-FR-3** — The find/replace panel text and inputs are legible and uniformly
  sized.
- **REQ-ZOOM-3** — The page-width gesture range spans a minimum up to the current
  window width; the column tracks window resize and clings to the window width
  when the window shrinks below the chosen width.
