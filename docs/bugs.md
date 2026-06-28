# szmde — Bug log

**The single central place to see every reported bug and its status.**

- This file = **bugs** only: behavior that violated an *existing, documented* requirement.
- **Requirements** (incl. ones born from under-specification feedback) live in the
  requirements registry, [traceability.md](traceability.md) — not here.
- Per-round feedback triage (how each comment was classified bug-vs-requirement)
  lives in its own working doc, e.g. [m4-feedback-triage.md](m4-feedback-triage.md),
  and feeds into this log. See [INDEX.md](INDEX.md) for the full doc map.

Status key: ✅ fixed · 🔧 in progress · ⬜ open.

## Open / in progress

_None._

## Known limitations (accepted trade-offs, not scheduled)

| Area | Limitation | Why accepted |
|------|-----------|--------------|
| Syntax-mode markers | Nested quotes (`> >`) / quoted headings (`> #`) overlap their hung markers in the gutter | Cost of keeping markers in the document flow (REQ-RENDER-9 B2/B6); a single widget would fix the visual but break editability |
| Syntax-mode markers | Very deep headings (`#####`/`######`) overhang far left and can overlap the fold chevron | The gutter is narrower than a 5–6 char marker; deep headings are rare |

## Fixed

### M4 feedback — round 3 (2026-06-28)

| ID | Title | REQ | Notes |
|----|-------|-----|-------|
| BUG-CURSOR-GLIDE | (Syntax / Formatted-reveal) cursor gliding across the hung markers was broken: the marker offset was set by a POST-LAYOUT plugin (`margin-left` from `offsetWidth` after CM laid out). CM recreates marker spans on every line re-render (caret move / scroll), losing the JS style until the plugin happened to re-run — so the marker flicked between gutter and margin and the native caret (which follows the DOM) landed in the wrong place (left margin / mid-marker / past the hashes, inconsistently). | REQ-RENDER-9 | Bake the offset into the DECORATION (inline `margin-left:-<canvas-measured width>`) so CM re-applies it on every render → marker always placed, caret glides consistently. Removed the measure plugin; the trailing space is a separate in-flow token. Verified live: `#` stable in the gutter across 10 cursor moves + typing; caret steps through every position; Formatted reveal stable too. Added cursor-glide contract tests (markers.dom.test.ts) across all 3 modes. |

### M4 feedback — round 2 (2026-06-28)

| ID | Title | REQ | Notes |
|----|-------|-----|-------|
| BUG-RENDER-OVERHANG | (Syntax) heading `#…` / quote `>` rendered to the RIGHT of the margin, overlapping the text, instead of hanging in the left gutter — a regression from the B2/B4 in-flow refactor (the `width:0; text-align:right` overflowed the wrong way) | REQ-RENDER-9, REQ-RENDER-10 | Re-fixed with an in-flow inline-block pulled left by minus its own measured width: hangs in the gutter, baseline-aligned, flush, editable, no `>` mirroring. _(The width was first applied by a post-layout plugin; that broke cursor gliding and was replaced by a decoration-baked offset — see BUG-CURSOR-GLIDE, round 3.)_ |
| BUG-FIND-SIZES | Find/replace panel had THREE different text sizes (buttons largest, checkbox labels medium, entry boxes smallest) — the C1/REQ-FR-3 fix used `input[type=text]`, but CM's inputs have NO `type` attr so it never matched (they kept CM's `.cm-textfield{font-size:70%}`), and CM's `& label{font-size:80%}` shrank the checkbox labels | REQ-FR-3 | Target `.cm-textfield` (not `input[type=text]`) and out-rank CM's label rule with `.cm-search.cm-panel label`. Verified live: all panel text now a uniform 13.6px. |

### M4 feedback — round 1 (2026-06-28)

| ID | Title | REQ | Notes |
|----|-------|-----|-------|
| B2 / B6 | (Syntax) hung block markers (`#…`, `>`) were not cursor-navigable / selectable (rendered as a replace widget, removed from flow) | REQ-RENDER-9 | Switched to an in-flow `Decoration.mark` |
| B4 | (Syntax) content list markers (bullets, ordered numbers) shown small-grey like pure syntax | REQ-RENDER-4 | Now normal text style (`cm-md-list-marker`), per the marker-vs-widget rule |
| B5 | Ctrl+Shift+M stopped toggling render mode after focus drifted off the editor | REQ-RENDER-7 | App-level keyboard fallback guarded by `defaultPrevented`; chip restores focus |
| BUG-ORD-TASK | Ordered task item `1. [ ] x` drew a stray `1.` ordinal next to the checkbox | REQ-RENDER-3 | Task guard added to the ordered branch (found by adversarial review) |
| BUG-FIND-FOCUS | Cycling render mode stole focus from the Find panel input | REQ-RENDER-7 | `editor.focus()` restricted to the chip path (found by adversarial review) |

_(B1 baseline, B3 fold-button prominence, B7 reveal-style were under-specification → new requirements REQ-RENDER-10, REQ-FOLD-2, REQ-RENDER-11, not bugs.)_

### M4 hardening — adversarial review (earlier, commit 48a0496)

| ID | Title | REQ |
|----|-------|-----|
| BUG-SETEXT | Setext heading underline blanked / mis-hung in render modes | REQ-RENDER-* |
| BUG-EMOJI-HTML | Emoji shortcodes rendered inside raw HTML blocks/comments/attributes | REQ-EMOJI-1 |
| BUG-FOLD-STALE | Fold chevron went stale when a Find match silently unfolded | REQ-FOLD-1 |
| BUG-ZOOM-RACE | Fast scroll-zoom raced settings writes on a shared temp file | REQ-ZOOM-1/2 |
| BUG-EMOJI-HEAD | Emoji in a heading rendered tiny | REQ-EMOJI-1 |

### M2 / M3 (historical — see git log for detail)

Checkbox not tiny-grey in Syntax mode · Tab focus-traversal regression · task
multi-line hang-indent alignment · HR click caret placement · click-to-edit for
alerts & tables · ordered-list nesting numbering · tables rendering nested inline
markdown · (M3) `compose_rev` FILETIME tick mismatch · atomic-write temp-file
collision.
