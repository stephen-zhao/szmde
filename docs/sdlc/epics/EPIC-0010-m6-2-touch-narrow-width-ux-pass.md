---
id: EPIC-0010
title: M6.2 — Touch & narrow-width UX pass
status: active
relations:
  implements:
    - REQ-0078
    - REQ-0075
    - REQ-0074
opened: 2026-08-17
---
Scoped 2026-07-20 from Stephen's on-device Android review; parked out of the M6 line so local-first S1-S6 ships first. Shared root cause: szmde assumes a fine pointer (hover+right-click) and a keyboard, so features become UNREACHABLE where that fails. Widened 2026-07-21 to add screen width (fixed left-edge lanes eat a ~412px viewport). Mixed status: REQ-UI-4 built (WF-37), REQ-LANE-1 built (unit, 2026-08-06), REQ-LANE-4 partial (static collapse built 2026-08-09, WF-39; reveal gesture + cascade deferred); REQ-UI-5, REQ-TBLED-8, REQ-TBLED-9 planned (SPEC §7, §7.4, §7.6).
