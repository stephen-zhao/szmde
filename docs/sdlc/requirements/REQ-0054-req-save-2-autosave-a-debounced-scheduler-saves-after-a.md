---
id: REQ-0054
title: 'REQ-SAVE-2 — Autosave: a debounced scheduler saves after a quiet interval…'
status: approved
opened: 2026-08-17
area: SAVE
spec_section: §8
test_type: unit
---
Autosave: a debounced scheduler saves after a quiet interval, coalescing bursts; honors editor.autosave/autosaveIntervalMs; disabling cancels pending; flush() forces a save; a failed save doesn't wedge later ones.

**Tests:** storage/autosave.test.ts  (unit)
**Live workflows:** WF-16

_Note:_ Live wiring → WF-16.
