---
id: REQ-0073
title: REQ-MOBILE-3 — Android SAF storage backend (SafProvider, saf.ts) over the…
status: approved
opened: 2026-08-17
area: MOBILE
spec_section: §6/§2
test_type: unit
---
Android SAF storage backend (SafProvider, saf.ts) over the StorageProvider seam: maps read/stat/write onto saf_read/saf_stat/saf_write Tauri commands over a scoped-storage content:// URI; composes rev = lastModified-byteLength so REQ-SAVE-1 conflict detection works verbatim; native saf_* impls call tauri-plugin-android-fs's Rust API off the WebView, persist the URI permission, and reopen the last file on next launch.

**Tests:** storage/saf.test.ts, platform.test.ts  (unit)
**Live workflows:** WF-32

_Note:_ Platform selection (platform.ts isAndroid, UA test) constructs it in place of LocalProvider on Android, sharing id 'local'; saf_read returns the DocumentFile display name for the title bar; device round-trip (pick→edit→save→conflict→reopen-after-restart) verified on a Pixel 9 Pro (WF-32, 2026-07-22, M6 S4 Phase A).
