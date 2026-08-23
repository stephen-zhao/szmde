---
id: ADR-0027
title: Android OAuth uses a reverse-client-id custom scheme, not an App Link
status: accepted
relations:
  informed_by:
    - SPK-0004
opened: 2026-08-17
---
**Choice:** Android sign-in uses Google's reverse-client-id custom scheme (com.googleusercontent.apps.<CLIENT_ID>:/oauth2redirect) with 'Custom URI scheme' enabled on the Android OAuth client; there is no assetlinks.json / domain hosting for sign-in. The www.zhaostephen.com assetlinks.json stays hosted, reserved for future REQ-INTEG-3.

**Why:** An Android OAuth client rejects https redirects (Error 400 redirect_uri_mismatch), and the custom-URI-scheme toggle is required (OFF by default → Error 400 invalid_request without it).

_Source: docs/android-signin-setup.md_
