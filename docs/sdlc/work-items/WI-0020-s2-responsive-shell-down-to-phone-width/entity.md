---
id: WI-0020
title: S2 — Responsive shell down to phone width
status: done
relations:
  parent: EPIC-0009
  implements:
    - REQ-0085
opened: 2026-08-17
---
Additive CSS on the shared shell: viewport meta, phone <600px breakpoint collapsing sidebar/HamburgerMenu into a drawer, >=48dp tap targets, safe-area insets. Acceptance: toolbar/drawer/editor usable by touch on a phone-sized emulator, no horizontal overflow, content clears system-bar insets, desktop layout unchanged. Soft keyboard deferred to S3. Done 2026-07-19 (commit 18cee48, PR #14); the on-device review that followed scoped M6.2.
