---
id: WI-0006
title: BUG-ANDROID-KEYSTORE — On Android every secure_* call failed at runtime (no default…
status: done
relations:
  implements:
    - REQ-0056
  parent: EPIC-0004
opened: 2026-08-17
---
On Android every secure_* call failed at runtime ('No default store has been set...') on the startup Drive-connection check. keyring v4 ships no Android store, so REQ-SEC-1 had no Android impl; additionally the android-native-keyring-store crate's ndk-context was never initialized by any Tauri component, so android_context() panicked and aborted app launch on device. Confirmed on device 2026-07-19 (M6 S1).

**Fix:** M6 S6a, device-verified 2026-07-25 (WF-33 Part A). (1) Register android-native-keyring-store as keyring-core's default in a cfg(android) .setup() hook; (2) initialize the NDK context via a JNI initializeNdkContext(applicationContext) call from MainActivity.onCreate (new io.crates.keyring.Keyring Kotlin shim) BEFORE the Rust runtime starts; and wrap Store::new() in catch_unwind so a panic can never brick launch. Verified secure_set->get->delete round-trips through the AndroidKeyStore-encrypted store; desktop untouched.

**Violates:** REQ-SEC-1
