---
id: SPK-0005
title: Android signing cert — is the upload keystore needed to device-test?
status: answered
relations:
  implements:
    - REQ-0084
opened: 2026-08-17
question: Which signing cert does the Android OAuth client key to, and is the upload/release keystore required to test Drive sign-in on a device?
---
An Android OAuth client is keyed to a (package, SHA-1) pair. The auto-created debug keystore (~/.android/debug.keystore, alias androiddebugkey, password android) keys the debug OAuth client, which is sufficient for device testing now — the upload/release keystore (szmde-upload.jks) is only needed for shipping (its own release OAuth client with the release SHA-1, custom-URI-scheme on, its scheme added to the manifest). Two certs ⇒ two clients ⇒ two client ids ⇒ gdrive_client.json differs per build (use the debug client id for testing). This machine's debug SHA-1 is recorded (per-machine, not secret).

_Source: docs/android-signin-setup.md_
