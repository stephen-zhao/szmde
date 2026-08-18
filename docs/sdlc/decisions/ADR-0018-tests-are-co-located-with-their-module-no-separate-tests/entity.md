---
id: ADR-0018
title: Tests are co-located with their module (no separate tests/ tree)
status: accepted
opened: 2026-08-17
---
**Choice:** Unit tests live beside their module as src/**/<module>.test.ts and integration tests as src/**/<module>.dom.test.ts (happy-dom EditorView); Rust units in src-tauri/src/lib.rs #[cfg(test)]; no separate tests/ tree. Decided 2026-06-27.

**Why:** Vitest idiom: a test imports its neighbor with ./x, coverage scoping is a clean src/**/*.ts, and a module + its test move/delete together.

_Source: docs/testing-strategy.md_
