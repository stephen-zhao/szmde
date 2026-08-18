---
id: REQ-0034
title: 'REQ-TBLED-11 — Per-table Pin header row: a long table''s header stays visible while…'
status: approved
opened: 2026-08-17
area: TBLED
spec_section: §7.4
test_type: unit + integration (DOM) + live
---
Per-table Pin header row: a long table's header stays visible while scrolling — CSS position:sticky in fit mode; a ViewPlugin translates <thead> in overflow mode; display-only, toggled from right-click menu.

**Tests:** table-display.test.ts, table-display.dom.test.ts  (unit + integration (DOM) + live)
**Live workflows:** WF-35, WF-36
