---
id: REQ-0028
title: REQ-TBLED-3 — Insert/delete rows and columns at any position via model ops +…
status: approved
opened: 2026-08-17
area: TBLED
spec_section: §7.4
test_type: unit + integration (DOM)
---
Insert/delete rows and columns at any position via model ops + commands (insertRowAbove/Below, insertColLeft/Right, deleteCurrentRow/Col) with a right-click context menu.

**Tests:** table-model.test.ts, table.dom.test.ts  (unit + integration (DOM))

_Note:_ Model S1; commands S3; right-click menu UI landed S3b (table-menu.ts); hover gizmos still pending.
