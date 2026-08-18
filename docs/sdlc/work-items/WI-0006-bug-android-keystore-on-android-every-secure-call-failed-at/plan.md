# Plan

- [x] M6 S6a, device-verified 2026-07-25 (WF-33 Part A). (1) Register android-native-keyring-store as keyring-core's default in a cfg(android) .setup() hook; (2) initialize the NDK context via a JNI initializeNdkContext(applicationContext) call from MainActivity.onCreate (new io.crates.keyring.Keyring Kotlin shim) BEFORE the Rust runtime starts; and wrap Store::new() in catch_unwind so a panic can never brick launch. Verified secure_set->get->delete round-trips through the AndroidKeyStore-encrypted store; desktop untouched.
