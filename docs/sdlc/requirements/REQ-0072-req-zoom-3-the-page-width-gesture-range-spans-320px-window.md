---
id: REQ-0072
title: REQ-ZOOM-3 — The page-width gesture range spans [320px, window width]…
status: approved
opened: 2026-08-17
area: ZOOM
spec_section: §7.3
test_type: unit + visual
---
The page-width gesture range spans [320px, window width]: Shift+scroll steps lineWidth in px capped at current window width, and the column clings to window width when it shrinks below the chosen width then grows back out (max-width:var(--reading-width) on an auto-width margin-auto block under box-sizing:border-box).

**Tests:** editor/zoom.test.ts  (unit + visual)
**Live workflows:** WF-23

_Note:_ Window-cap clamp unit-covered; live resize → WF-23.
