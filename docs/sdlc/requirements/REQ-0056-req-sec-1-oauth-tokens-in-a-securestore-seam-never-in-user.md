---
id: REQ-0056
title: REQ-SEC-1 — OAuth tokens in a SecureStore seam (never in user.json)…
status: approved
opened: 2026-08-17
area: SEC
spec_section: §6
test_type: unit + unit (Rust)
---
OAuth tokens in a SecureStore seam (never in user.json): serialize/parse (corrupt→re-auth, never throws), early-refresh isExpired with skew, account-keyed save/load/clear; desktop over the OS credential store via keyring; Android parity via a cfg(android) keyring-core store.

**Tests:** storage/secure-store.test.ts, storage/tauri-secure-store.test.ts, src-tauri/src/lib.rs  (unit + unit (Rust))
**Live workflows:** WF-33 Part A

_Note:_ Android parity M6 S6a — device-verified 2026-07-25 (WF-33 Part A, Pixel 9 Pro): android-native-keyring-store registered via cfg(android) hook, ndk-context init in MainActivity.onCreate, Store::new() wrapped in catch_unwind. See BUG-ANDROID-KEYSTORE.
