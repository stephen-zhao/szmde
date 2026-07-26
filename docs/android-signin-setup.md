# Android Google Drive sign-in — maintainer setup (M6 S6)

**The one-page runbook for the manual steps that turn on Google Drive sign-in on Android.**
Everything here is a maintainer task (Google Cloud Console, a signing cert) — the code side
(deep-link capture, custom-scheme redirect, Keystore token storage) ships in M6 S6. Design:
[m6-plan.md](m6-plan.md); on-device acceptance: [llm-workflow-tests.md](llm-workflow-tests.md) (WF-33).

## Where we are

- ✅ **M6 S6 sign-in is device-verified end-to-end** on a Pixel 9 Pro (WF-33, 2026-07-25/26): Connect →
  system-browser Custom Tab → consent → token in the Android Keystore → `drive.file` read/write
  round-trip → survives an app restart.
- This doc is what a **new** maintainer / a **release** build needs to reproduce that setup.

## The redirect is a custom scheme (not an App Link)

Android's OAuth redirect is Google's **reverse-client-id custom scheme**:

```
com.googleusercontent.apps.<CLIENT_ID>:/oauth2redirect
```

where `<CLIENT_ID>` is the OAuth client id with `.apps.googleusercontent.com` stripped. The app
derives it from the client_id and registers it in the deep-link config / AndroidManifest; **you don't
type it anywhere**. We tried an https App Link first, but an Android OAuth client **rejects https
redirects** (Error 400 `redirect_uri_mismatch`) — so there is **no `assetlinks.json` and no domain
hosting** for sign-in. _(The `assetlinks.json` at `www.zhaostephen.com` is unused by sign-in; it stays
hosted, reserved for the future REQ-INTEG-3 "Open in szmde from Drive.")_

## You do NOT need the upload keystore to test on a device

There are two signing certs; an Android OAuth client is keyed to a **(package, SHA-1)** pair:

| Cert | Where it lives | Exists yet? | Used for |
|------|----------------|-------------|----------|
| **Debug** | `~/.android/debug.keystore` (alias `androiddebugkey`, password `android`) | ✅ auto-created | the debug OAuth client — **device testing now** |
| **Release / upload** | `szmde-upload.jks` (you generate — see [ci-cd.md](ci-cd.md)) | ❌ not yet | the release OAuth client — **shipping only** |

Read a cert's **SHA-1**:

```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android    # debug
keytool -list -v -keystore <path>/szmde-upload.jks -alias szmde-upload                              # release (later)
```

**This machine's debug SHA-1** (read 2026-07-25 — not secret; it's per-machine, re-run the command on any other machine):
`99:0F:3D:81:82:60:7C:C0:2E:7B:4F:5D:44:79:D4:A6:5D:CC:E6:82`

## Step 1 — Create the Android OAuth client (Google Cloud Console)

In the same Google Cloud project as the desktop client, create a **new** OAuth client of type
**Android** (one per cert — the debug client now, a second with the release SHA-1 at shipping):

- **Package name:** `com.zhaostephen.szmde`
- **SHA-1 certificate fingerprint:** the debug SHA-1 above
- There is **no redirect field** — an Android client uses the reverse-client-id scheme automatically.
- ⚠️ **Advanced Settings → enable "Custom URI scheme"** (OFF by default — without it, sign-in fails with
  Error 400 `invalid_request`). **This is the toggle that makes it work.**

Copy the resulting **client ID** (`…apps.googleusercontent.com`) for Step 2. Cloud Console navigation
mirrors the desktop walkthrough in [m3-cloud-setup.md § 1](m3-cloud-setup.md) — only the client *type*
(Android, package + SHA-1, custom-URI-scheme enabled) differs. Two clients ⇒ two client ids, so
`gdrive_client.json` differs per build; use the **debug** client's id for testing.

## Step 2 — Provide `gdrive_client.json`

szmde reads its client config from `<app_config_dir>/gdrive_client.json` (on Android:
`/data/user/0/com.zhaostephen.szmde/gdrive_client.json`). Shape (template:
[src-tauri/gdrive_client.example.json](../src-tauri/gdrive_client.example.json)) — **`client_secret`
is empty** (Android is a public client, pure PKCE):

```json
{
  "client_id": "<the Android client ID from Step 1>.apps.googleusercontent.com",
  "client_secret": ""
}
```

Push it onto the device (the config dir is app-private):

```bash
adb push gdrive_client.json /data/local/tmp/gdrive_client.json
adb shell run-as com.zhaostephen.szmde cp /data/local/tmp/gdrive_client.json /data/user/0/com.zhaostephen.szmde/gdrive_client.json
```

## Step 3 — (shipping only) release client + manifest scheme

For a signed release: generate the upload keystore ([ci-cd.md § Android signing](ci-cd.md)), create a
**second** Android OAuth client with the **release** SHA-1 (and enable Custom URI scheme on it too), and
**add that client's reverse-client-id scheme to the AndroidManifest** intent-filter (debug and release
have different ids → different schemes).

## Then: WF-33 Part B (already verified with the debug cert)

Once Steps 1–2 are done (debug) and the Pixel has network: Connect → system-browser Custom Tab → sign in
→ grant `drive.file` → the custom-scheme redirect routes back → token persists in the Keystore →
read/write a Drive file → kill+relaunch reconnects. Full script: [llm-workflow-tests.md § WF-33](llm-workflow-tests.md).

## Checklist

- [ ] Android OAuth client created (package `com.zhaostephen.szmde` + debug SHA-1)
- [ ] **"Custom URI scheme" enabled** on that client (Advanced Settings)
- [ ] `gdrive_client.json` (debug client id, empty secret) pushed to the app config dir
- [ ] _(shipping)_ upload keystore + release OAuth client (release SHA-1, custom-URI-scheme on) + its scheme added to the manifest
