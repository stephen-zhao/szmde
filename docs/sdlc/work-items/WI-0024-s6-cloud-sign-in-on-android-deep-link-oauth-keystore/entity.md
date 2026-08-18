---
id: WI-0024
title: S6 — Cloud sign-in on Android (deep-link OAuth + keystore)…
status: done
relations:
  parent: EPIC-0009
  implements:
    - REQ-0057
    - REQ-0056
opened: 2026-08-17
---
Device-verified end-to-end on a Pixel 9 Pro (WF-33, 2026-07-25/26). S6a (keystore) device-verified 2026-07-25 (WF-33 Part A): android-native-keyring-store + keyring-core as cfg(android) deps, registered as keyring-core's default in a cfg(android) .setup() hook; fixed the ndk-context panic by calling Kotlin initializeNdkContext(applicationContext) from MainActivity.onCreate, and the .setup() hook catch_unwinds Store::new() so a panic can never brick launch (fixes BUG-ANDROID-KEYSTORE; secure_set->get->delete round-trip proven). S6b (deep-link OAuth) device-verified 2026-07-26 (WF-33 Part B): tauri-plugin-deep-link + plugins.deep-link config + mobile-only capability deep-link:default; redirect capture is pure JS in gdrive-connect.ts (Android branch: launch a system-browser Custom Tab via opener -> onOpenUrl/getCurrent -> state-filtered -> token exchange), fully unit-covered (100% lines). The redirect is Google's reverse-client-id CUSTOM SCHEME (com.googleusercontent.apps.<id>:/oauth2redirect), NOT an https App Link (Android OAuth client rejects https with Error 400 redirect_uri_mismatch); maintainer must enable 'Custom URI scheme' on the client. Adversarial review 2026-07-25: 5 raised, 2 confirmed & fixed (vacuous CSRF-state test, keystore setup ? that would panic launch). On Android 'Open from Drive' is hidden (Picker = M6.1); Connect/Disconnect work. Acceptance device-verified: Connect -> Custom Tab -> consent -> custom-scheme redirect -> access + refresh tokens persist in Keystore; drive.file create->write->read->delete round-trip succeeds; force-stop + relaunch reads the token back (silent reconnect). Resolved risk #2.
