---
id: EPIC-0009
title: M6 — Android
status: active
relations:
  implements:
    - REQ-0084
    - REQ-0085
    - REQ-0073
opened: 2026-08-17
---
Current milestone (m6-plan.md, SPEC §2). Per the top What's-left table: local-first + Drive sign-in complete, S1-S6 merged and device-verified on a Pixel 9 Pro. S1 cross-compile (all 4 ABIs + gen/android), S2 responsive shell, S3 soft-keyboard/IME inset bridge, S4 SAF storage (WF-32), S5 signed-release workflows + Android CI, S6 Google Drive sign-in (Android Keystore WF-33 Part A + reverse-client-id custom-scheme OAuth redirect WF-33 Part B, both device-verified; an Android OAuth client rejects https App Link redirects). Scope decided 2026-07-18: M6 = S1-S6; Drive Picker deferred to M6.1; Play Store is REQ-PLAY-1 later. Remaining before a SHIPPED build is maintainer-only: S5 upload keystore + repo secrets + a workflow_dispatch dry-run, and a release Android OAuth client (release SHA-1 + Custom URI scheme + manifest scheme). NOTE: the lower M6 slot section (lines 115-125) is stale, still saying only S1 landed / emulator boot pending / APK pending Developer Mode — contradicted by the more-current top table and CLAUDE.md.
