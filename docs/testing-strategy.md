# Testing strategy

_Status: **requirements defined; implementation scheduled after M1 (post-S6), before M2** —
a "testing gate" milestone. See [SPEC.md §10](../SPEC.md). This doc is the source of truth for
how szmde is tested; it will gain a live traceability matrix when T3 is implemented._

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

## Implementation order (the testing gate, after S6 / before M2)

1. Add coverage tooling + reporting; set an initial threshold and ratchet toward 100% (T1).
2. Backfill unit tests for existing modules to reach the threshold; add `cargo test` for Rust units.
3. Build the requirement catalog + traceability matrix; tag tests with requirement IDs (T3).
4. Expand integration tests for critical combinations; note any deferred (orchestration-needing) ones (T2).
