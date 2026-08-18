---
id: REQ-0060
title: REQ-COUNT-1 — Live word/character count of the raw buffer (render-mode…
status: approved
opened: 2026-08-17
area: COUNT
spec_section: §7.1/§5.4
test_type: unit
---
Live word/character count of the raw buffer (render-mode independent): code-point chars excluding line breaks, Unicode word runs; off-by-default read-only status chip (appearance.showWordCount).

**Tests:** editor/count.test.ts  (unit)
**Live workflows:** WF-19

_Note:_ Status-chip wiring + no-lag is .svelte/live → WF-19.
