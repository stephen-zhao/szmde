---
id: REQ-0026
title: 'REQ-TBLED-1 — Insert an N×M table from scratch: makeTable model +…'
status: approved
opened: 2026-08-17
area: TBLED
spec_section: §7.4
test_type: unit + integration (DOM)
---
Insert an N×M table from scratch: makeTable model + insertTable(rows,cols) command wired through EditorApi, with a hamburger Insert → Table hover-preview grid picker.

**Tests:** table-model.test.ts, table.dom.test.ts  (unit + integration (DOM))

_Note:_ Model S1; command/UI S6 (table-commands.ts, TableSizePicker.svelte).
