---
id: WI-0017
title: BUG-ZOOM-RACE — Fast scroll-zoom raced settings writes on a shared temp file
status: done
relations:
  implements:
    - REQ-0064
    - REQ-0065
  parent: EPIC-0005
opened: 2026-08-17
---
Fast scroll-zoom raced settings writes on a shared temp file.

**Fix:** Fixed in the M4 hardening adversarial review (commit 48a0496); no per-bug fix note in the log.

**Violates:** REQ-ZOOM-1, REQ-ZOOM-2
