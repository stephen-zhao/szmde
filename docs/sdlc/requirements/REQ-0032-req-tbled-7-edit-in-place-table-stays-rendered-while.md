---
id: REQ-0032
title: 'REQ-TBLED-7 — Edit-in-place: table stays rendered while editing a cell — clicking…'
status: approved
opened: 2026-08-17
area: TBLED
spec_section: §7.4
test_type: unit + integration (DOM)
---
Edit-in-place: table stays rendered while editing a cell — clicking opens an inline <textarea> over that cell's markdown source (Enter/Tab commit+move, Esc cancels, blur commits, pipes/newlines sanitized).

**Tests:** table-model.test.ts, table.dom.test.ts, table-cell-editor.dom.test.ts  (unit + integration (DOM))

_Note:_ table-cell-editor.ts; Formatted mode no longer reveals raw pipes (Source mode only); rendered table atomic so arrows skip past.
