---
id: REQ-0084
title: 'REQ-MOBILE-1 — Android build target: committed tauri android init output…'
status: approved
opened: 2026-08-17
area: MOBILE
spec_section: §2
test_type: none (build-time gate)
---
Android build target: committed tauri android init output (src-tauri/gen/android); Rust entry point cfg-split so desktop-only CLI/single-instance/OAuth-loopback compile out on mobile; minSdk 24, compile/target SDK 36; conditional signed release configs and a path-filtered Android build check.
**Live workflows:** WF-29
**Coverage gap:** no deterministic automated test (yet) — see body/notes.

_Note:_ The acceptance is the build itself — a build-time gate, not a unit test. CI-enforced since S5: android.yml debug-builds aarch64 on every PR touching src-tauri/** (advisory), release job builds all four ABIs signed. Live boot → WF-29.
