package io.crates.keyring

import android.content.Context

/**
 * JNI shim for `android-native-keyring-store` (M6 S6a, REQ-SEC-1 parity).
 *
 * That crate gets its Android app context from the `ndk-context` crate, which nothing in a
 * Tauri 2 app initializes: tao (ndk-glue) never populates `ndk-context`'s global, and
 * `tauri-plugin-android-fs` reaches its context another way — so `ndk_context::android_context()`
 * PANICS ("android context was not initialized") the moment the keystore is touched. On device
 * that aborted app launch (caught in WF-33 Part A, 2026-07-25).
 *
 * The crate ships this exact companion contract (see its `Application Requirements`); the JNI
 * symbol `Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext` is compiled into
 * our own native library (the crate is statically linked into `szmde_lib`), so we load THAT lib,
 * not the crate's. `MainActivity.onCreate` calls `initializeNdkContext(applicationContext)` before
 * the Rust runtime starts, so the keystore setup hook + every `secure_*` command have the context.
 *
 * `System.loadLibrary` is idempotent (Tauri also loads `szmde_lib`), so triggering it here just
 * guarantees the symbol is resolvable when `initializeNdkContext` is first called.
 */
class Keyring {
    companion object {
        init {
            System.loadLibrary("szmde_lib")
        }

        external fun initializeNdkContext(context: Context)
    }
}
