---
id: WI-0013
title: BUG-FIND-FOCUS — Cycling render mode stole focus from the Find panel input
status: done
relations:
  implements:
    - REQ-0007
  parent: EPIC-0002
opened: 2026-08-17
---
Cycling render mode stole focus from the Find panel input.

**Fix:** editor.focus() restricted to the chip path (found by adversarial review). (M4 round 1.)

**Violates:** REQ-RENDER-7
