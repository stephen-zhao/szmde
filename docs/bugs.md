# szmde — Bug log

**The single central place to see every reported bug and its status.**

- This file = **bugs** only: behavior that violated an *existing, documented* requirement.
- **Requirements** (incl. ones born from under-specification feedback) live in the
  requirements registry, [requirements.md](requirements.md) — not here.
- Per-round feedback triage (how each comment was classified bug-vs-requirement)
  lives in its own working doc, e.g. [m4-feedback-triage.md](archive/m4-feedback-triage.md),
  and feeds into this log. See [INDEX.md](INDEX.md) for the full doc map.

Status key: ✅ fixed · 🔧 in progress · ⬜ open.

## Open / in progress

| ID | Title | REQ | Notes |
|----|-------|-----|-------|
| BUG-MODAL-ACTIONS-OVERFLOW | The save-conflict / unsaved-changes modal's action row (`.modal-actions`, `src/routes/+page.svelte`) is a single non-wrapping flex row, so at ≤375px the primary **Overwrite** / **Save** button can be pushed off-screen. Found in the M6 S2 adversarial review, 2026-07-20. | REQ-SAVE-1 | ⬜ open. Violates REQ-SAVE-1 — the conflict resolution is only usable if its buttons are reachable. Fix is `flex-wrap` + full-width buttons under the phone breakpoint. Needs a live check (happy-dom has no layout); folded into **M6.2**. |
| BUG-FIND-PANEL-INSET | The Find & Replace panel (`.cm-panels-top`) has no top safe-area inset, so on a phone it lays out at viewport y=0 — inside the ~52px status-bar band. Found in the M6 S2 adversarial review, 2026-07-20. | REQ-FR-1 | ⬜ open, currently **masked**: Find is keyboard-only, so it cannot be opened on a phone at all. REQ-UI-4 (M6.2) unmasks it — fix both together. The inset belongs on `.cm-panels.cm-panels-top` (additive `env()`), *not* on `.cm-editor`/`.app`, which would double-count against `.cm-content`'s top padding. |
| BUG-ANDROID-KEYSTORE | On Android every `secure_*` call fails at runtime — _"No default store has been set, so cannot search or create entries"_ (logcat `E Tauri/Console`, seen on first launch from the startup Drive-connection check). Confirmed on device 2026-07-19 (M6 S1). | REQ-SEC-1 | ⬜ open. `keyring` v4 does **not** auto-register an Android store, so REQ-SEC-1 has no implementation on Android even though it is shipped on Windows. Fix is scheduled as part of **M6 S6**: add `android-native-keyring-store` as a `cfg(target_os="android")` dependency and register it as the default store, then verify the round-trip on device. Fallback: `tauri-plugin-keyring`. |
| BUG-ALERT-ICON-OVERLAP | (Formatted mode) GFM alert/callout boxes (`> [!TIP]`, `> [!WARNING]`, …) render with the **type icon overlapping the label/body text** instead of sitting beside it — the icon and text collide. Reported 2026-07-18. | REQ-ALERT-1 | ⬜ open. Violates REQ-ALERT-1 ("callout boxes with an icon+name label") — a CSS layout defect in the alert widget (likely the icon's absolute/negative positioning vs. the label's left padding). happy-dom has no layout, so this needs a **live WF** (add it red, then fix to green — TDD for interaction, per testing-strategy T3). Check every alert type + that a long wrapping body doesn't slide under the icon. |

## Known limitations (accepted trade-offs, not scheduled)

| Area | Limitation | Why accepted |
|------|-----------|--------------|
| Syntax-mode markers | An EXTREME combined prefix — a quoted deep heading (`> ###### `) or 4+ nested quotes (`> > > > `) — can exceed the marker-gutter width (`--marker-gutter`, sized for `######` / `> >`) and reach a few px into the fold-chevron column | The gutter is sized for the common cases; these prefixes are very rare. (The previous, much commoner overlaps — any nested quote, and `#####`/`######` colliding with the chevron — are now FIXED by the 3-column layout, REQ-RENDER-12.) |
| Syntax-mode markers | A TAB inside a block-marker prefix (e.g. `>\tquote`) makes the gutter text-indent slightly off — canvas `measureText` doesn't expand tabs to tab stops the way layout does | A tab right after a marker is unusual; the misalignment is a few px. Headings are unaffected (lezer doesn't admit a tab there). |
| Folding | A foldable heading INSIDE a blockquote (`> # h`) has its chevron shifted right by the blockquote's bar padding vs a plain heading's chevron | The chevron anchors to its line's padding box; a quoted *foldable* heading is rare and the offset is ~bar-padding small. |

## Fixed

### M4 feedback — round 4 (2026-06-28)

| ID | Title | REQ | Notes |
|----|-------|-----|-------|
| BUG-REVEAL-JITTER | (Formatted/Clean mode) the whole heading/quote CONTENT twitched by a sub-pixel on every caret on/off-line, because revealing a marker changed the LAYOUT — hidden = marker removed + no indent; revealed = marker shown + `text-indent`, and the canvas-measured indent `W` can't be pixel-identical to the rendered prefix width `A`, so the content landed at a slightly different spot in each state (Δ = A−W). | REQ-RENDER-8/11 | In Clean mode, block markers now ALWAYS hang in the gutter in flow; revealing flips only their COLOUR (transparent `cm-md-mark-invisible` → grey `cm-md-mark-syntax`), so the layout is identical in both states and the content never moves (the A−W offset becomes a constant static nudge, not a per-reveal jitter). Costs nothing visually (block markers live in the reserved gutter column). Trade-off: Clean-mode block markers are now in-flow/non-atomic (caret glides through, like Syntax) instead of removed/atomic; inline markers unchanged. Confirmed in WebView2 (M4 shipped & merged). |
| BUG-CARET-MARGIN | (Syntax / Formatted-reveal) the native caret rendered at the left margin instead of in the gutter, just before a hung block marker — only the *rendering* (the document flow was already correct). Root cause: the caret for "before `#`" attaches to the line's inline content ORIGIN, but the negative-margin hang moved only the marker GLYPH, leaving the origin at the margin. Engine-dependent (some Chromium builds drew it at the glyph, WebView2 at the margin); CM's own `RectangleMarker` cursor also placed it at the margin (46 vs the glyph at 37), so swapping to a CM-drawn cursor did NOT help. | REQ-RENDER-9 | Replaced the per-marker negative margin with a per-LINE `text-indent` equal to the marker prefix's measured width: text-indent shifts the inline origin itself, so the native caret follows the glyph into the gutter in EVERY engine (no custom cursor needed). Re-architected the left edge into 3 columns — [chevron][marker gutter][content] (REQ-RENDER-12) — so the fold chevron has its own lane (no longer overlaps deep `######`) and nothing clips when the page width is maxed (REQ-ZOOM-4). Re-measured on font load / size change so a customizable font stays aligned. Verified live (WF-24): caret sits at the glyph left (`caretRectX == coordsX == glyph.left`), glides smoothly through the marker, `######` clears the chevron by ~19px, text flush, columns visible at min & max width. Confirmed in WebView2 (M4 shipped & merged). |

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
