---
id: EPIC-0007
title: Least-privilege Google Drive picker
status: closed
relations:
  implements:
    - REQ-0059
opened: 2026-08-17
---
Shipped 2026-07-11 ahead of numbered M6+ slots (OneDrive deprioritized same day). Replaces restricted full-drive scope with non-sensitive drive.file; pre-existing files open via system-browser Google Picker (trigger_onepick) over existing OAuth loopback. No CSP change, no authorized JS origin, no token in page JS; hardened loopback. Code+tests done; live round-trip (WF-28, user-run) still pending (gdrive-picker-plan.md, SPEC §6).
