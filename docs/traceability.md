# Requirement ↔ test traceability (T3)

> **This is the central requirements registry.** Bugs are tracked separately in
> [bugs.md](bugs.md); see [INDEX.md](INDEX.md) for the full doc map.

_The auditable map from product requirements to the tests that cover them
([testing-strategy.md](testing-strategy.md) T3). Every implemented requirement has a stable
`REQ-*` ID, links to its test(s), and is tagged in those tests so the audit is **automatable**:
`node scripts/check-traceability.mjs` cross-checks the IDs catalogued here against the `[REQ-*]`
tags in the test files and flags either side that's missing._

## How the link works

- Each requirement below has an ID like `REQ-<AREA>-<n>`.
- Tests are tagged by prefixing the relevant `describe()` (or a specific `it()`) title with the
  ID(s) in brackets, e.g. `describe("[REQ-RENDER-2] Clean mode — rendered DOM", …)`.
- `scripts/check-traceability.mjs` greps the test tree for `REQ-*` tags and compares to the
  **Catalog** IDs here: it errors if a catalogued (implemented) requirement has no tagged test,
  or if a test references an unknown ID. Run it in CI alongside `npm run test:coverage`.

## Catalog (implemented — each maps to ≥1 test)

| ID | Requirement | SPEC | Test type | Covered by |
|----|-------------|------|-----------|-----------|
| REQ-RENDER-1 | Three render modes with single-word labels (Formatted/Source/Syntax) and a defined order | §4.1 | unit | `render-mode.test.ts` |
| REQ-RENDER-2 | Clean mode hides syntax markers; reveals them when the caret is on/within the construct | §4.1 | integration (DOM) | `markers.dom.test.ts` |
| REQ-RENDER-3 | Clean mode renders bullets as `•` and keeps ordered numbers (semantic content), styled | §4.1/§5.1 | integration (DOM) | `markers.dom.test.ts` |
| REQ-RENDER-4 | Syntax mode shows markers as small tokens, kept in the text | §4.1 | integration (DOM) | `markers.dom.test.ts` |
| REQ-RENDER-5 | Source mode keeps markers visible while styling the construct | §4.1 | integration (DOM) | `markers.dom.test.ts` |
| REQ-RENDER-6 | Clean-mode hidden markers are atomic (arrow-skip / single delete) | §4.1 | integration (DOM) | `markers.dom.test.ts` |
| REQ-RENDER-7 | Render-mode cycle command advances through the order and wraps around | §4.1 | unit | `render-mode.test.ts` |
| REQ-RENDER-8 | Clean mode hides a fully-hidden block marker's trailing space too (it's syntax) — heading (`# `) and blockquote (`> `) text render flush, no leading space | §4.1 | integration (DOM) | `markers.dom.test.ts` |
| REQ-FORMAT-1 | Bold toggle (`Ctrl/Cmd+B`) wraps/unwraps `**`; inert in code | §4.2/§5.1 | integration | `editing.test.ts` |
| REQ-FORMAT-2 | Italic toggle (`Ctrl/Cmd+I`) wraps/unwraps `*`; inert in code | §4.2/§5.1 | integration | `editing.test.ts` |
| REQ-LIST-1 | Enter continues a list (new bullet / incremented ordinal) | §5.1 | integration | `editing.test.ts` |
| REQ-LIST-2 | Enter on an empty item outdents (nested) or exits the list (top-level) | §5.1 | integration | `editing.test.ts` |
| REQ-LIST-3 | Enter on a continuation line opens a new sibling item | §5.1 | integration | `editing.test.ts` |
| REQ-LIST-4 | Tab nests an empty list item; otherwise inserts a soft tab honoring indent style | §4.4/§5.1 | integration | `editing.test.ts` |
| REQ-LIST-5 | Shift+Enter soft break hangs under the item's content | §5.1 | integration | `editing.test.ts` |
| REQ-LIST-6 | Clean-mode hang-indent renders as an invisible marker-prefix clone (font-robust) | §4.1/§5.1 | integration (DOM) | `markers.dom.test.ts` |
| REQ-HR-1 | Horizontal rule renders as a divider in Clean (atomic + reveal-on-cursor); literal chars kept/greyed in Source/Syntax; frontmatter `---` is not a rule | §5.1 | integration (DOM) | `hr.dom.test.ts` |
| REQ-TASK-1 | Task items render a checkbox in Clean (no `•`, checked state reflects `[x]`); literal `[ ]`/`[x]` kept in Source/Syntax | §5.1 | integration (DOM) | `tasklist.dom.test.ts` |
| REQ-TASK-2 | Clicking a task checkbox toggles the on-disk char (`[ ]`⇄`[x]`), only that item | §5.1 | integration (DOM) | `tasklist.dom.test.ts` |
| REQ-IMG-1 | Inline image renders as `<img>` (src+alt) in Clean (atomic + reveal-on-cursor); literal markdown kept in Source/Syntax | §5.1 | integration (DOM) | `image.dom.test.ts` |
| REQ-IMG-2 | Image src resolution: http(s)/data pass through; local/relative via injectable resolver; reference-style resolves, unresolved stays literal | §5.1 | integration (DOM) | `image.dom.test.ts` |
| REQ-ALERT-1 | GFM alerts (`> [!TYPE]`) render as per-type callout boxes with an icon+name label (5 types, case-insensitive) | §5.1 | integration (DOM) | `alerts.dom.test.ts` |
| REQ-ALERT-2 | Alert box shows in every mode; the `[!TYPE]` label reveals literally on cursor / in Source; a normal or bogus blockquote is unaffected | §5.1 | integration (DOM) | `alerts.dom.test.ts` |
| REQ-TABLE-1 | GFM pipe table renders as a real `<table>` in Clean (header/body cells, per-column alignment); header-only tables don't crash | §5.1 | integration (DOM) | `table.dom.test.ts` |
| REQ-TABLE-2 | Table reveals raw pipe source on cursor (atomic); literal pipe text kept in Source/Syntax | §5.1 | integration (DOM) | `table.dom.test.ts` |
| REQ-NEST-1 | Nested lists render (mixed ordered/unordered); unordered bullets vary by depth (•/◦/▪) and continuation hang-indents track the depth glyph | §5.1 | integration (DOM) | `nested.dom.test.ts` |
| REQ-BLOCK-1 | ATX headings get `cm-h1`..`cm-h6` by level | §5.1 | integration (DOM) | `blocks.test.ts` |
| REQ-BLOCK-2 | Blockquote lines get `cm-blockquote` (every line; no bleed) | §5.1 | integration (DOM) | `blocks.test.ts` |
| REQ-BLOCK-3 | Fenced code blocks render as cards (open/close/content classes, content box, per-block + editor-wide wrap) | §5.1 | integration (DOM) | `setup.test.ts` |
| REQ-BLOCK-4 | YAML frontmatter preamble is parsed as frontmatter, not a heading | §5.1 | integration | `frontmatter.test.ts` |
| REQ-EOL-1 | Detect EOL on open (LF/CRLF/mixed→LF), default LF, write chosen EOL on save | §4.4 | unit | `eol.test.ts` |
| REQ-INDENT-1 | Configurable indentation (Spaces 2/4 ⇄ Tab); read-back reflects config | §4.4 | unit + integration | `indent.test.ts`, `editing.test.ts` |
| REQ-INDENT-2 | `convertIndentation` preserves visual width and skips fenced-code interiors | §4.4 | integration | `indent.test.ts` |
| REQ-UI-1 | Scrollbar gutter is reserved so the centered column doesn't shift | §7 | integration (DOM) | `theme.dom.test.ts` |
| REQ-FILE-1 | Read a file's contents (`read_file`) | §6 | unit (Rust) | `src-tauri/src/lib.rs` |
| REQ-FILE-2 | Atomic save (`write_file`: temp + rename, no residue) | §6 | unit (Rust) | `src-tauri/src/lib.rs` |
| REQ-CLI-1 | CLI parsing: flags, render-mode validation, help/version exit codes, usage errors | §2.1 | unit (Rust) | `src-tauri/src/lib.rs` |
| REQ-CLI-2 | CLI path resolution: relative→cwd, absolute unchanged | §2.1/§6.1 | unit (Rust) | `src-tauri/src/lib.rs` |
| REQ-BUILD-1 | App ships as a static SPA (SSR disabled) for the Tauri shell | §3 | unit | `routes/layout.test.ts` |
| REQ-SET-1 | Two-tier settings service: DEFAULTS<system<user deep-merge, minimal-diff persistence, no-op write guard, resilient load (missing/corrupt/I-O all degrade, never throw) | §8 | unit | `settings/service.test.ts`, `settings/backend.test.ts`, `settings/tauri-backend.test.ts` |
| REQ-SET-2 | Settings schema/validation/migration: DEFAULTS, drop-invalid-or-unknown→default, thin partials, version-stamped forward migration | §8 | unit | `settings/schema.test.ts`, `settings/validate.test.ts`, `settings/migrate.test.ts`, `settings/merge.test.ts` |
| REQ-SET-3 | Appearance applied to CSS custom properties; atomic settings-file IO with absent→None vs I/O→Err | §8 | unit + unit (Rust) | `settings/appearance.test.ts`, `src-tauri/src/lib.rs` |
| REQ-SAVE-1 | Save conflict detection: a local file's revision (`mtime-len`) is the baseline; a save over a file changed on disk is detected (rev mismatch → `StorageError("conflict")`) and offers overwrite / save-copy / reload | §6 | unit + unit (Rust) | `storage/local.test.ts`, `storage/conflict.test.ts`, `src-tauri/src/lib.rs` (the modal interaction → WF-15) |
| REQ-SAVE-2 | Autosave: a debounced scheduler saves after a quiet interval, coalescing bursts; honors `editor.autosave` / `autosaveIntervalMs`; disabling cancels pending; `flush()` forces a save; a failed save doesn't wedge later ones | §8 | unit | `storage/autosave.test.ts` (live wiring → WF-16) |
| REQ-SAVE-3 | Offline draft cache + write queue: a write that fails `offline` is stashed (coalesced per file) and replayed in order on reconnect; a non-offline failure drops from the queue; drafts persist across restarts via a `DraftStore` seam | §6 | unit | `storage/offline.test.ts` (shell activation + a live-offline workflow land with a cloud backend, S7) |
| REQ-SEC-1 | OAuth tokens in a `SecureStore` seam (never in user.json): token model serialize/parse (corrupt→re-auth, never throws), early-refresh `isExpired` with skew, account-keyed save/load/clear; desktop impl over the OS credential store (Windows Credential Manager / macOS Keychain) via the `keyring` crate | §6 | unit + unit (Rust) | `storage/secure-store.test.ts`, `storage/tauri-secure-store.test.ts`, `src-tauri/src/lib.rs` (`secure_*` round-trip) |
| REQ-CLOUD-1 | Google Drive backend over the StorageProvider seam (OAuth + Drive REST): read media+etag, write with `If-Match` optimistic concurrency, stat; HTTP→error mapping (412⇒conflict, 401/403⇒auth, 404⇒not-found, network⇒offline) | §6 | unit | `storage/gdrive.test.ts`, `storage/cloud-http.test.ts`, `storage/oauth.test.ts` (live OAuth + network + Drive ETag semantics → WF-17) |
| REQ-CLOUD-2 | OneDrive backend over the StorageProvider seam (OAuth + Microsoft Graph): Graph item content read/write (PUT) with `If-Match`, stat; same shared error mapping as Drive | §6 | unit | `storage/onedrive.test.ts`, `storage/cloud-http.test.ts`, `storage/oauth.test.ts` (live OAuth + network + Graph ETag semantics → WF-18) |
| REQ-COUNT-1 | Live word/character count of the raw buffer (render-mode independent): code-point chars excluding line breaks; Unicode word runs (apostrophes/hyphens within a word). Shown as an off-by-default read-only status chip (`appearance.showWordCount`) | §7.1/§5.4 | unit | `editor/count.test.ts` (the status-chip wiring + no-lag is `.svelte`/live → WF-19) |
| REQ-FR-1 | Find & replace (incl. regex / case / whole-word) via `@codemirror/search`: themed top panel, literal-by-default, `Mod-f`; matches run on the raw doc and a match selected on a hidden Clean-mode marker line reveals it | §5.4 | integration (DOM) | `editor/search.dom.test.ts` (live panel UX/theme → WF-20) |
| REQ-EMOJI-1 | Emoji shortcodes `:code:` render as a glyph in Clean mode (literal kept on disk, reveal-on-cursor, atomic); unknown / inline-code / fenced / URL stay literal; Source/Syntax keep literal; gated by `markdown.emoji` | §5.4 | unit + integration (DOM) | `editor/emoji.test.ts`, `editor/emoji.dom.test.ts` (live glyph render → WF-21) |
| REQ-FOLD-1 | Collapsible heading sections: lang-markdown's heading foldService + `codeFolding` (`⋯` placeholder); an inline chevron on heading lines only (no gutter → centered column preserved) + `Mod-.` toggle; the body folds, the heading stays visible; identical across render modes; `#` in fenced code isn't a heading | §5.4 | integration (DOM) | `editor/fold.dom.test.ts` (live affordance/visual → WF-22) |
| REQ-ZOOM-1 | Ctrl/Cmd+scroll zooms the base text size (one step/event, `stepFontSize` clamp 10–32) and persists to `appearance.fontSize`; reading width stays constant so text wraps sooner | §7.3 | unit | `editor/zoom.test.ts` (live wheel gesture → WF-23) |
| REQ-ZOOM-2 | Shift+scroll steps the page width (`stepLineWidth`, ±40px/tick, clamped) and persists to `appearance.lineWidth` (px); see REQ-ZOOM-3 for the window-relative range | §7.3 | unit | `editor/zoom.test.ts` (live wheel gesture → WF-23) |
| REQ-RENDER-9 | Syntax mode (and Formatted reveal): a block marker's whole leading prefix (`#`…/`>`(s) + spaces) hangs in the LEFT marker-gutter column so the heading/quote text stays flush — via a per-LINE `text-indent: -<prefix width>` (the prefix's canvas-measured width, baked into a line `Decoration` so CM re-applies it on every render) plus a small-grey mark over the prefix. text-indent (NOT a per-marker negative margin) is the crux of the caret fix: it shifts the line's inline ORIGIN, so the native caret follows the glyph into the gutter in EVERY engine (a negative margin moved only the glyph → caret stranded at the margin in WebView2). The chars stay REAL/EDITABLE/SELECTABLE in the document flow (a mark, never a replace/post-layout style) so the caret glides through them consistently; one indent per line even for nested `> >`/`> #`; inline markers stay plain; no hang in Source. Re-measured on font change (`remeasureOnFontChange`) | §4.1 | integration (DOM) | `editor/markers.dom.test.ts` (in-flow proof + cursor-glide contract: no widget-buffer, zero atomic, step-through positions, decoration-carried text-indent; live gutter/flush/glide/caret-in-gutter → WF-24) |
| REQ-RENDER-11 | Formatted-mode reveal-on-cursor renders markers in Syntax style (small-grey inline; gutter-hung block markers) via the shared `pushShownMark`, not raw Source literals; revealed markers stay editable (a mark, never atomic) and the text doesn't shift when the caret lands (the gutter is reserved in every mode) | §4.1 | integration (DOM) | `editor/markers.dom.test.ts` |
| REQ-RENDER-12 | The editor lays out three left-to-right columns — [fold chevron][marker gutter][content] — reserved as `.cm-content` left padding (`--fold-col` + `--marker-gutter`, sized off `--editor-font-size`). The fold chevron lives in its OWN column, absolutely positioned and so unaffected by the heading line's text-indent → its lane is fixed regardless of heading depth and never collides with a deep `######`'s hung markers (the old overlap). The gutter holds the hung Syntax-mode markers (REQ-RENDER-9); content stays flush. The two columns are reserved in EVERY render mode so toggling/revealing never shifts text | §4.1/§5.4/§7 | integration (DOM) + visual | `editor/markers.dom.test.ts`, `editor/fold.dom.test.ts` (live columns/no-overlap → WF-24) |
| REQ-FOLD-2 | The heading fold affordance is a prominent button chip (border + raised fill, `role=button` + `aria-expanded`), body-sized so it's the same on any heading level, in its own dedicated left column (REQ-RENDER-12), consistent across all render modes | §5.4 | integration (DOM) + visual | `editor/fold.dom.test.ts` (button attrs; live prominence → WF-22) |
| REQ-FR-2 | Find/replace supports regex capture-group references in the replacement: `$1`-style (CM native) and `\1`-style (translated `\1`→`$1` while in regexp mode, leaving `\n`/`\t`/`\\` and escaped `\\1` intact) | §5.4 | unit + integration (DOM) | `editor/replace-groups.test.ts`, `editor/search-replace.dom.test.ts` |
| REQ-ZOOM-3 | The page-width gesture range spans `[320px, window width]`: Shift+scroll steps `lineWidth` in px capped at the current window width, and the column clings to the window width when it shrinks below the chosen width then grows back out (a `max-width:var(--reading-width)` on an auto-width margin-auto block under global `box-sizing:border-box` — fills the container up to the chosen px) | §7.3 | unit + visual | `editor/zoom.test.ts` (window-cap clamp; live resize → WF-23) |

## Requirements with no automated test (honest gaps — tracked, not silent)

| ID | Requirement | SPEC | Why no test (yet) |
|----|-------------|------|-------------------|
| REQ-PERF-1 | No perceptible typing lag | §4.3 | No *automated* test — covered by LLM workflow **WF-14** ([llm-workflow-tests.md](llm-workflow-tests.md)); deterministic profiling harness still TODO. |
| REQ-UI-2 | Status-bar widgets (filename / render-mode / EOL / indent chips) drive their actions | §7.1 | `.svelte` UI — covered by LLM workflow **WF-12**; the underlying editor APIs they call **are** unit-tested. |
| REQ-LOOK-1 | "Modern, sleek, unified" dark-default look | §1/§7 | Subjective/visual — covered by LLM-judged workflow **WF-13** (rubric over screenshots). |
| REQ-RENDER-10 | Syntax/Formatted-reveal hung block markers are baseline-aligned with the heading/quote text | §4.1 | The hung prefix is now ordinary in-flow small-grey text shifted by the line's `text-indent`, so it sits on the natural text baseline (no inline-block to top-float); happy-dom has no layout — covered by **WF-24**. |
| REQ-FR-3 | Find/replace panel text + inputs legible and uniformly sized | §5.4 | Pure CSS sizing — happy-dom has no layout; covered by **WF-20**. |
| REQ-ZOOM-4 | Page-width range accounts for all three columns (REQ-RENDER-12) — chevron + marker gutter reserved inside `--reading-width` (border-box), so the window-width max keeps every column on-screen (the old negative-margin chevron clipped when maxed) | §7.3 | Pure layout (border-box padding) — happy-dom has no layout; covered by **WF-24**. |
| REQ-CLI-3 | `wsl_to_unc` translates a WSL path to a UNC path | §6.1 | Shells out to `wsl.exe` → integration, not a unit; needs WSL present. |
| REQ-FS-1 | Open/save via local FS, Google Drive, OneDrive, network storage | §6 | Cloud/network backends not yet implemented (post-v1). |

**Live-behavior layer.** The Vitest/cargo tests above cover document model + decoration structure,
not real layout/click/caret/visual behavior. Those are covered by the LLM-driven workflow suite in
[llm-workflow-tests.md](llm-workflow-tests.md) (WF-1…WF-14), each linked back to a `REQ-*` and the bug
that motivated it. Run it before releases and after editor-interaction changes (it is **not** part of
the CI `npm run test`/`test:trace` gate — it needs an LLM agent + a live WebView).

_Future requirements (tables editing §7.4, Alt-hints §7.5, tabs/panes §7.2, zoom §7.3, and the
rest of §5.4) enter this table with linked tests as they're built._
