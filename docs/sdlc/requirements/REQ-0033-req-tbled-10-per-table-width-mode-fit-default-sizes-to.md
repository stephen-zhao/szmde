---
id: REQ-0033
title: REQ-TBLED-10 — Per-table Width mode — fit (default, sizes to reading width) vs…
status: approved
opened: 2026-08-17
area: TBLED
spec_section: §7.4
test_type: unit + integration (DOM) + live
---
Per-table Width mode — fit (default, sizes to reading width) vs. overflow (columns sized to header cell, own independent horizontal scrollbar); display-only, on-disk GFM unchanged.

**Tests:** table-display.test.ts, table-display.dom.test.ts  (unit + integration (DOM) + live)
**Live workflows:** WF-34

_Note:_ Ephemeral per-table state (table-display.ts tableDisplays); ViewPlugin measure pass pins <col> widths from header (flicker-free).
