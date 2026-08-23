---
id: REQ-0065
title: REQ-ZOOM-2 — Shift+scroll steps the page width (stepLineWidth, ±40px/tick…
status: approved
opened: 2026-08-17
area: ZOOM
spec_section: §7.3
test_type: unit
---
Shift+scroll steps the page width (stepLineWidth, ±40px/tick, clamped) and persists to appearance.lineWidth (px).

**Tests:** editor/zoom.test.ts  (unit)
**Live workflows:** WF-23

_Note:_ See REQ-ZOOM-3 for the window-relative range; live wheel gesture → WF-23.
