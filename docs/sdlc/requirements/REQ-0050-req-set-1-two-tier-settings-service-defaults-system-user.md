---
id: REQ-0050
title: 'REQ-SET-1 — Two-tier settings service: DEFAULTS<system<user deep-merge…'
status: approved
opened: 2026-08-17
area: SET
spec_section: §8
test_type: unit
---
Two-tier settings service: DEFAULTS<system<user deep-merge, minimal-diff persistence, no-op write guard, resilient load (missing/corrupt/I-O degrade, never throw).

**Tests:** settings/service.test.ts, settings/backend.test.ts, settings/tauri-backend.test.ts  (unit)

_Note:_ Two-tier merge itself is settings/merge.test.ts.
