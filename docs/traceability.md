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
| REQ-FORMAT-1 | Bold toggle (`Ctrl/Cmd+B`) wraps/unwraps `**`; inert in code | §4.2/§5.1 | integration | `editing.test.ts` |
| REQ-FORMAT-2 | Italic toggle (`Ctrl/Cmd+I`) wraps/unwraps `*`; inert in code | §4.2/§5.1 | integration | `editing.test.ts` |
| REQ-LIST-1 | Enter continues a list (new bullet / incremented ordinal) | §5.1 | integration | `editing.test.ts` |
| REQ-LIST-2 | Enter on an empty item outdents (nested) or exits the list (top-level) | §5.1 | integration | `editing.test.ts` |
| REQ-LIST-3 | Enter on a continuation line opens a new sibling item | §5.1 | integration | `editing.test.ts` |
| REQ-LIST-4 | Tab nests an empty list item; otherwise inserts a soft tab honoring indent style | §4.4/§5.1 | integration | `editing.test.ts` |
| REQ-LIST-5 | Shift+Enter soft break hangs under the item's content | §5.1 | integration | `editing.test.ts` |
| REQ-LIST-6 | Clean-mode hang-indent renders as an invisible marker-prefix clone (font-robust) | §4.1/§5.1 | integration (DOM) | `markers.dom.test.ts` |
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

## Requirements with no automated test (honest gaps — tracked, not silent)

| ID | Requirement | SPEC | Why no test (yet) |
|----|-------------|------|-------------------|
| REQ-PERF-1 | No perceptible typing lag | §4.3 | Performance/perception — needs profiling or an LLM-judged rubric over captured interaction; infra deferred. |
| REQ-UI-2 | Status-bar widgets (filename / render-mode / EOL / indent chips) drive their actions | §7.1 | Lives in `.svelte` UI; needs a component/E2E harness (WebView E2E deferred). The underlying editor APIs they call **are** unit-tested. |
| REQ-LOOK-1 | "Modern, sleek, unified" dark-default look | §1/§7 | Subjective/visual — LLM-judged against a rubric over screenshots; infra deferred. |
| REQ-CLI-3 | `wsl_to_unc` translates a WSL path to a UNC path | §6.1 | Shells out to `wsl.exe` → integration, not a unit; needs WSL present. |
| REQ-FS-1 | Open/save via local FS, Google Drive, OneDrive, network storage | §6 | Cloud/network backends not yet implemented (post-v1). |
| REQ-SET-1 | Two-tier (system + user) JSON settings | §8 | Settings system is M2; not yet implemented. |

_Future requirements (tables editing §7.4, Alt-hints §7.5, tabs/panes §7.2, zoom §7.3, and the
rest of §5.4) enter this table with linked tests as they're built._
