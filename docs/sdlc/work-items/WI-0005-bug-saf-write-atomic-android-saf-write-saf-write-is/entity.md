---
id: WI-0005
title: BUG-SAF-WRITE-ATOMIC — Android SAF write (saf_write) is truncate-and-replace, not…
status: dropped
relations:
  implements:
    - REQ-0073
  parent: EPIC-0009
opened: 2026-08-17
---
saf_write is a truncate-and-replace against the content:// document (android-fs write()), NOT the atomic sibling-temp+rename the local backend uses (write_atomic). An interrupted save (process kill / provider error / storage detached mid-write) can leave the file truncated. Found in the M6 S4 adversarial review. Listed under 'Known limitations (accepted trade-offs, not scheduled)' — deferred/accepted because SAF offers no portable atomic-rename across providers, the window is narrow, and conflict-detection rev catches the next open. Revisit if data-loss reports appear.

**Violates:** REQ-MOBILE-3
