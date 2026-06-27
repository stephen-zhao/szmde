# Testing strategy

_Status: **testing gate complete** (after M1, before M2; deferred E2E/LLM infra aside). See
[SPEC.md §10](../SPEC.md). **T1 — done** (coverage tooling + ratchet; 100% lines + Rust units).
**T2 — substantially in place** (editor integration tests); orchestration-needing cases deferred.
**T3 — done** (catalog + matrix in [traceability.md](traceability.md); tests tagged with
`REQ-*` IDs; `npm run test:trace` audits the link). **T4 — in practice** (TDD). M2 is unblocked._

## Requirements

| ID | Requirement |
|----|-------------|
| **T1** | **100% unit-test code coverage.** Mock what must be mocked for isolated unit testing. |
| **T2** | **Integration tests** for combinations of building blocks that are critical for functionality. (May be added later where it needs environment orchestration / spinning up other components — such cases are noted, not silently skipped.) |
| **T3** | **Every product requirement has linked functional test(s), auditable.** The test may be a unit, integration, or LLM-driven behavioral test — whichever fits that requirement best — and is linked to the requirement so coverage of requirements is auditable. |
| **T4** | **TDD when possible** — write the failing test that captures intended behavior before writing the implementation (once the behavior is planned). Already in practice for editor behaviors. |

## T1 — 100% unit coverage

- **Tooling:** Vitest coverage (`@vitest/coverage-v8`), run via `npm run test -- --coverage`; enforce a
  threshold (target 100% lines/branches/functions/statements). **Ratchet up** to the target rather than
  flip 100% on at once, so we don't block on a big-bang backfill.
- **Scope / exclusions:** exclude generated and non-source (`src-tauri/gen/**`, `.svelte-kit/**`,
  `build/**`), config files, and type-only declarations. Every exclusion is **explicit and reviewed** —
  never a silent gap (per the no-silent-caps principle).
- **Mocking:** isolate units; mock Tauri APIs (`@tauri-apps/*`), the filesystem, and dialogs. For the CM
  editor logic, prefer a **real `EditorState`/`EditorView`** (deterministic, already the approach) over
  mocking CM internals.
- **Rust (`src-tauri`):** `cargo test` + coverage (e.g. `cargo-llvm-cov`) for the Rust units —
  `parse_cli`, `resolve_path`/`wsl_to_unc`, atomic `write_file`, single-instance arg handling.

## T2 — integration tests

- **Editor building-block combinations** (the current pattern in `src/lib/editor/editing.test.ts`): a real
  `EditorView` with the full `editorExtensions()` + dispatched key events, covering render-mode ×
  markers × keymap × block decorations interactions (this is where precedence bugs hid).
- **Tauri command ↔ frontend flows** (open/save, single-instance forwarding, EOL on save): may need a
  Tauri test harness or mocked IPC — **deferred** where it needs orchestration; noted here when so.
- **App-level E2E** (launch the built app, drive the UI): **deferred** — needs orchestration
  (`tauri-driver`/WebDriver). Tracked as future infra.

## T3 — requirement ↔ test traceability (auditable)

1. **Catalog product requirements** with stable IDs, sourced from SPEC.md (e.g. `REQ-<area>-<n>` such as
   `REQ-RENDERMODE-1`, or reuse SPEC section numbers). The catalog lives here as a matrix.
2. **Traceability matrix:** Requirement ID → description → linked test(s) (`file::test name`) → test type
   (unit / integration / LLM-behavioral) → status. Every requirement maps to ≥1 functional test.
3. **Link mechanism:** tag tests with the requirement ID (e.g. `it("[REQ-RENDERMODE-1] markers hidden in
   Formatted mode", …)`) so a small script can extract which requirements are covered and flag any
   without a test — making the audit automatable, not manual.
4. **LLM-driven behavioral tests:** for fuzzy/visual/UX requirements that resist deterministic assertions
   (e.g. "modern, sleek look", "no typing lag perception"), use an LLM judge against a written rubric over
   captured output/screenshots. Infra **deferred**; the requirement still gets a linked test entry (even if
   "manual/LLM-judged") so it's accounted for.

## T4 — TDD

Failing-test-first once a behavior is planned. Demonstrated this iteration: the empty-nested-list-item
Enter bug was reproduced by a failing test (the realistic "sibling above" structure) before the fix.

## T1 results (done)

- **Tooling:** `@vitest/coverage-v8`, run via `npm run test:coverage`. v8 provider, `all: true`,
  scope `src/**/*.ts`. Explicit exclusions (no silent gaps): `*.test.ts`; `.svelte` UI components
  (integration/E2E, deferred); `.svelte.ts` Svelte-5 runes glue (e.g. `settings/store.svelte.ts` —
  needs the Svelte compiler/runes runtime this plain-vitest setup lacks; its logic lives in the
  100%-covered pure service it delegates to); `src-tauri` Rust (→ `cargo test`); generated/types/config.
- **Backfill:** 71% → **100% lines** (statements 98.7%, functions 98.7%, branches 93.4%) across
  124 unit/integration tests. New suites: `setup`, `frontmatter`, `render-mode`, `blocks`,
  `theme.dom`, `layout`, plus edge extensions to `indent`/`markers.dom`/`editing`.
- **Honest residual (not chased to 100%):** the sub-100% statement/branch/function gaps are
  defensive `state.field(_, false)` guards, single-line-fence edges, and CodeMirror widget-diff
  plumbing that only the real WebView exercises. The genuinely-unreachable bits carry explicit
  `/* v8 ignore */` with reasons; we hold ratchet floors (lines 100, stmts/funcs 98, branches 93)
  rather than fake the last few percent with contrived tests.
- **Rust units (done):** 14 `cargo test` tests for the pure backend logic — `parse_cli`
  (flags, render-mode validation, help/version exit codes, usage errors), `resolve_path`
  (absolute / relative-joins-cwd / no-cwd), and atomic `write_file` + `read_file` (roundtrip,
  in-place overwrite, no temp residue, missing-file error). Run via
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`. (`wsl_to_unc` shells out to
  `wsl.exe` → integration, not unit-tested. `cargo-llvm-cov` line coverage: optional, deferred.)

## Implementation order (the testing gate, after S6 / before M2)

1. ✅ Add coverage tooling + reporting; set thresholds and ratchet toward 100% (T1).
2. ✅ Backfill unit tests for existing modules to reach the threshold. ✅ `cargo test` for Rust units (14).
3. ✅ Build the requirement catalog + traceability matrix; tag tests with requirement IDs (T3).
   → [traceability.md](traceability.md) (28 requirements, 6 tracked gaps), `npm run test:trace`.
4. ✅ Integration tests for critical combinations in place (render-mode × markers × keymap ×
   blocks, code-block wrap); E2E + Tauri-IPC orchestration cases noted as deferred (T2).
