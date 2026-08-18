---
id: WI-0012
title: BUG-ORD-TASK — Ordered task item '1. [ ] x' drew a stray '1.' ordinal next to…
status: done
relations:
  implements:
    - REQ-0003
  parent: EPIC-0002
opened: 2026-08-17
---
An ordered task item '1. [ ] x' drew a stray '1.' ordinal next to the checkbox.

**Fix:** Task guard added to the ordered branch (found by adversarial review). (M4 round 1.)

**Violates:** REQ-RENDER-3
