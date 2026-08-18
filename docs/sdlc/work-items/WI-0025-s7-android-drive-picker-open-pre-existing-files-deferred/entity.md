---
id: WI-0025
title: S7 — Android Drive Picker (open pre-existing files) — deferred…
status: ready
relations:
  parent: EPIC-0009
  implements:
    - REQ-0059
opened: 2026-08-17
---
Deferred out of the M6 line to M6.1 (decision 1, 2026-07-18) as the highest-uncertainty item; lands after the M6 local + Drive-sign-in line ships. Planned approach: a native Google Identity Services AuthorizationRequest Kotlin plugin (PICKER_OAUTH_TRIGGER resource, drive.file-only) returning picked_file_ids via the deep-link redirect; mobile-gate pickGoogleDriveFiles. Acceptance: on-device, pick a pre-existing Drive file via the native Picker and open it read/write.
