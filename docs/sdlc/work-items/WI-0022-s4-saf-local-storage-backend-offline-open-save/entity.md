---
id: WI-0022
title: S4 — SAF local storage backend (offline open/save)
status: done
relations:
  parent: EPIC-0009
  implements:
    - REQ-0073
opened: 2026-08-17
---
Done 2026-07-22. The milestone's core shippable. Mechanism: tauri-plugin-android-fs (decision #3, spike-proven, v28.4.0, pinned). SafProvider seam (offline TDD, id 'local', storage/saf.test.ts + platform.test.ts) + saf_read/saf_stat/saf_write/saf_pick/saf_pick_save Rust commands over android-fs's Rust API (its JS surface compiled out via default-features=false, kept off the WebView) + Android-only restore-last-file (reopen via persisted URI on launch). Settings stay app-private std::fs. Verified on a Pixel 9 Pro (WF-32): pick real .md -> edit -> save (no false conflict) -> external change -> conflict modal -> Overwrite -> force-stop + relaunch auto-reopens with no picker, fully offline. Retired risk #7.
