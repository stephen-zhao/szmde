---
id: WI-0019
title: S1 — Boots on emulator (toolchain + android init + cross-compile)
status: done
relations:
  parent: EPIC-0009
  implements:
    - REQ-0084
opened: 2026-08-17
---
Provision the Android toolchain, bump keyring 3->4 (required just to cross-compile), cfg(desktop)-gate the CLI + loopback OAuth, run tauri android init and commit gen/android, set minSdk 24 (compileSdk/targetSdk 36 are template defaults). Acceptance: tauri android dev launches the blank editor in an emulator; cargo build succeeds for all 4 ABIs; desktop tauri dev + npm test still green. Done 2026-07-19 (commit 5337110, PR #16): all four ABIs build clean, keyring pinned at 4, gen/android committed, minSdk 24. Retired risk #1.
