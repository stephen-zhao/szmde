---
id: WI-0023
title: S5 — Signed release AAB/APK + Android CI
status: executing
relations:
  parent: EPIC-0009
  implements:
    - REQ-0084
opened: 2026-08-17
---
Workflows + signing landed 2026-07-22: conditional signingConfigs in app/build.gradle.kts (absent keystore.properties -> unsigned, never breaks local builds); a hand-rolled android release job (ubuntu, JDK 17 + pinned NDK via shared composite action, keystore from ANDROID_KEY_* base64 secrets, --apk --aab, assets attached to the same tag Release, workflow_dispatch dry-run) -- NOT tauri-action (risk #9); plus path-filtered PR Android build check (android.yml, aarch64 debug) enforcing the REQ-MOBILE-1 build gate on src-tauri/** PRs. Runbook: ci-cd.md. Marked next (in progress) -- remaining work is maintainer-only.
