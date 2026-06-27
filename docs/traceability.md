# Requirement ↔ test traceability (T3)

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
| REQ-RENDER-8 | Clean mode hides the ATX heading marker's trailing space too (it's syntax) — heading text renders flush, no leading space | §4.1 | integration (DOM) | `markers.dom.test.ts` |
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

## Requirements with no automated test (honest gaps — tracked, not silent)

| ID | Requirement | SPEC | Why no test (yet) |
|----|-------------|------|-------------------|
| REQ-PERF-1 | No perceptible typing lag | §4.3 | No *automated* test — covered by LLM workflow **WF-14** ([llm-workflow-tests.md](llm-workflow-tests.md)); deterministic profiling harness still TODO. |
| REQ-UI-2 | Status-bar widgets (filename / render-mode / EOL / indent chips) drive their actions | §7.1 | `.svelte` UI — covered by LLM workflow **WF-12**; the underlying editor APIs they call **are** unit-tested. |
| REQ-LOOK-1 | "Modern, sleek, unified" dark-default look | §1/§7 | Subjective/visual — covered by LLM-judged workflow **WF-13** (rubric over screenshots). |
| REQ-CLI-3 | `wsl_to_unc` translates a WSL path to a UNC path | §6.1 | Shells out to `wsl.exe` → integration, not a unit; needs WSL present. |
| REQ-FS-1 | Open/save via local FS, Google Drive, OneDrive, network storage | §6 | Cloud/network backends not yet implemented (post-v1). |

**Live-behavior layer.** The Vitest/cargo tests above cover document model + decoration structure,
not real layout/click/caret/visual behavior. Those are covered by the LLM-driven workflow suite in
[llm-workflow-tests.md](llm-workflow-tests.md) (WF-1…WF-14), each linked back to a `REQ-*` and the bug
that motivated it. Run it before releases and after editor-interaction changes (it is **not** part of
the CI `npm run test`/`test:trace` gate — it needs an LLM agent + a live WebView).

_Future requirements (tables editing §7.4, Alt-hints §7.5, tabs/panes §7.2, zoom §7.3, and the
rest of §5.4) enter this table with linked tests as they're built._
