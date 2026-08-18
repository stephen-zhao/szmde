# Findings

An Android OAuth client REJECTS https redirects (Error 400 redirect_uri_mismatch) — an App Link was tried first and failed. Must use the reverse-client-id custom scheme com.googleusercontent.apps.<CLIENT_ID>:/oauth2redirect (derived from client_id, registered in the deep-link config/AndroidManifest). So there is NO assetlinks.json and no domain hosting for sign-in (the www.zhaostephen.com assetlinks stays hosted, reserved for future REQ-INTEG-3 'Open in szmde from Drive'). Also required: enable 'Custom URI scheme' in the Android client's Advanced Settings — OFF by default; without it sign-in fails Error 400 invalid_request. Device-verified end-to-end on a Pixel 9 Pro (WF-33 Part A+B, Connect → Custom Tab → consent → Keystore token → drive.file round-trip → survives restart).

_Investigated 2026-07-25/26, source: docs/android-signin-setup.md._
