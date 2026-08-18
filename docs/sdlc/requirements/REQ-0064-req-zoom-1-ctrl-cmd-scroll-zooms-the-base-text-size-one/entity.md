---
id: REQ-0064
title: REQ-ZOOM-1 — Ctrl/Cmd+scroll zooms the base text size (one step/event…
status: approved
opened: 2026-08-17
area: ZOOM
spec_section: §7.3
test_type: unit
---
Ctrl/Cmd+scroll zooms the base text size (one step/event, stepFontSize clamp 10–32) and persists to appearance.fontSize; reading width stays constant so text wraps sooner.

**Tests:** editor/zoom.test.ts  (unit)
**Live workflows:** WF-23

_Note:_ Live wheel gesture → WF-23.
