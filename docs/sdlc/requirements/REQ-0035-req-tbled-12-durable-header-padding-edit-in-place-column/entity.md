---
id: REQ-0035
title: 'REQ-TBLED-12 — Durable header padding + edit-in-place column width: overflow column…'
status: approved
opened: 2026-08-17
area: TBLED
spec_section: §7.4
test_type: unit + structure + live
---
Durable header padding + edit-in-place column width: overflow column width persists through structural ops (serialize keepHeaderPad); adjustable in Formatted mode via a header-cell resize grip and an inline editor spanning content+trailing padding.

**Tests:** table-model.test.ts, table-display.dom.test.ts, table-cell-editor.dom.test.ts  (unit + structure + live)
**Live workflows:** WF-38

_Note:_ serialize(m, keepHeaderPad=true); tables.ts addColResizeGrip / headerPadChange; sanitizeHeaderCell; only explicit Tidy re-fits; overflow header content renders flush-left.
