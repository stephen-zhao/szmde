---
id: ADR-0022
title: Android build check is advisory, not a required status check
status: accepted
opened: 2026-08-17
---
**Choice:** The path-filtered Android build check is deliberately NOT a required GitHub check; a red ✗ is treated as merge-blocking by convention only.

**Why:** GitHub waits forever on a required check whose path filter never fired, which would hang every PR that does not touch src-tauri.

_Source: docs/ci-cd.md_
