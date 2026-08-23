---
id: REQ-0031
title: REQ-TBLED-6 — Auto-tidy + per-column alignment…
status: approved
opened: 2026-08-17
area: TBLED
spec_section: §7.4
test_type: unit + integration (DOM)
---
Auto-tidy + per-column alignment: parseTable/serialize/tidy/setColAlign (fitted serialize, empty cells preserved, fixes lezer node-index bug); alignment via right-click menu.

**Tests:** table-model.test.ts, table.dom.test.ts  (unit + integration (DOM))

_Note:_ Model S1; alignment reachable via S3b menu; explicit Tidy command + remaining alignment affordance in S4.
