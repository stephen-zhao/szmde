---
id: REQ-0025
title: REQ-TABLE-2 — A rendered table is atomic (arrows skip past it, cursor never…
status: approved
opened: 2026-08-17
area: TABLE
spec_section: §5.1
test_type: integration (DOM)
---
A rendered table is atomic (arrows skip past it, cursor never enters); raw pipe source appears in Source mode only.

**Tests:** table.dom.test.ts  (integration (DOM))

_Note:_ Original reveal-on-cursor-to-pipes model removed in M5 S2 in favour of the inline cell editor (REQ-TBLED-7).
