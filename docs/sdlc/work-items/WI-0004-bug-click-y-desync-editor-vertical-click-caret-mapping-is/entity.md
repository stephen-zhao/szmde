---
id: WI-0004
title: BUG-CLICK-Y-DESYNC — Editor vertical click->caret mapping is desynced; caret lands…
status: ready
relations:
  implements:
    - REQ-0067
    - REQ-0069
  parent: EPIC-0010
opened: 2026-08-17
---
Clicking in the document places the caret / registers the hit lower than the pointer. Reported by Stephen while verifying the REQ-LANE-4 branch; described as resurfaced (a recurrence of the caret/click-alignment class). Open, needs deterministic repro: rule out (1) stale HMR and (2) branch (main vs lane-drawers PR #34) first. Likely a vertical offset CM doesn't account for feeding posAtCoords. Add a live WF (red->green) before fixing.

**Violates:** REQ-RENDER-9, REQ-RENDER-12
