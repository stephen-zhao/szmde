# Findings

An Android OAuth client is keyed to a (package, SHA-1) pair. The auto-created debug keystore (~/.android/debug.keystore, alias androiddebugkey, password android) keys the debug OAuth client, which is sufficient for device testing now — the upload/release keystore (szmde-upload.jks) is only needed for shipping (its own release OAuth client with the release SHA-1, custom-URI-scheme on, its scheme added to the manifest). Two certs ⇒ two clients ⇒ two client ids ⇒ gdrive_client.json differs per build (use the debug client id for testing). This machine's debug SHA-1 is recorded (per-machine, not secret).

_Investigated 2026-07-25, source: docs/android-signin-setup.md._
