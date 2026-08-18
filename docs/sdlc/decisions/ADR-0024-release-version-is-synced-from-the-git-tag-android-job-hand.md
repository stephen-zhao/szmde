---
id: ADR-0024
title: Release version is synced FROM the git tag; Android job hand-rolled
status: accepted
opened: 2026-08-17
---
**Choice:** Both release jobs rewrite src-tauri/tauri.conf.json version from the v* tag (minus v); package.json / Cargo.toml stay as-is. The Android release job is hand-rolled (npx tauri android build --apk --aab) rather than using tauri-action.

**Why:** The tag drives Android versionName/versionCode via regenerated gen/android/app/tauri.properties; tauri-action's mobile support is experimental (m6-plan risk #9).

_Source: docs/ci-cd.md_
