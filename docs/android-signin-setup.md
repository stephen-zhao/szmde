# Android Google Drive sign-in — maintainer setup (M6 S6)

**The one-page runbook for the manual steps that turn on Google Drive sign-in on Android.**
Everything here is a maintainer task (hosting, Google Cloud Console, a keystore) — the code side
(deep-link capture, Keystore token storage) already ships in M6 S6. See
[m6-plan.md](m6-plan.md) for the design and [llm-workflow-tests.md](llm-workflow-tests.md) (WF-33)
for the on-device acceptance test.

## Where we are

- ✅ **S6a — Android Keystore: done, device-verified** (WF-33 Part A). Token storage works on device.
- ⏳ **S6b — deep-link OAuth: code-complete**, but the *live sign-in flow* (WF-33 Part B) needs the
  steps below before it can run end-to-end. On Android the redirect is an **https App Link**
  (`https://www.zhaostephen.com/szmde/oauth2redirect`) that Android only routes back into the app once the
  domain is verified against the app's **signing certificate**.

## First: you do NOT need the upload keystore to test on a device

There are **two** signing certificates, and the confusion is which one the SHAs come from:

| Cert | Where it lives | Exists yet? | Used for | Needed for… |
|------|----------------|-------------|----------|-------------|
| **Debug** | `~/.android/debug.keystore` (Windows: `%USERPROFILE%\.android\debug.keystore`), alias `androiddebugkey`, password `android` | ✅ **Yes** — auto-created by the Android tooling on the first debug build | Signing `--debug` APKs (what `adb install` puts on the Pixel) | **Device testing now** |
| **Release / upload** | `szmde-upload.jks` — you generate it (M6 S5) | ❌ Not yet | Signing the release APK/AAB you ship | **Shipping only** (add later) |

Because the app you sideload for testing is a **debug** build, Android verifies the App Link against
the **debug** cert. So: **use the debug cert now; add the release cert when you ship.** `assetlinks.json`
holds an *array* of fingerprints, so both can be listed side by side — no rework.

### Getting the SHAs

```bash
# Debug cert (already generated — this is what you need now):
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android

# Release cert (later, after you create szmde-upload.jks — see Step 4):
keytool -list -v -keystore <path>/szmde-upload.jks -alias szmde-upload
```

**This machine's debug cert** (read 2026-07-25 — not secret; these go straight into `assetlinks.json`):

- **SHA-1** (→ the Android OAuth client): `99:0F:3D:81:82:60:7C:C0:2E:7B:4F:5D:44:79:D4:A6:5D:CC:E6:82`
- **SHA-256** (→ `assetlinks.json`): `7F:EC:74:94:03:C8:D8:88:5B:6A:CD:07:77:4D:C2:45:89:31:32:7D:B8:8C:6B:07:54:4E:69:03:19:F9:63:48`

> A debug keystore is per-machine — on any other machine, re-run the command above to get that
> machine's fingerprints.

## Step 1 — Host `assetlinks.json`

Serve this at **`https://www.zhaostephen.com/.well-known/assetlinks.json`** — real HTTPS,
`Content-Type: application/json`, **returning `200` with no redirect**. It must sit at the **App Link
host**, which is **`www.zhaostephen.com`**: the site (Cloudflare → GitHub Pages) is canonical at `www`,
so the app targets `www`. Do **not** rely on the apex `zhaostephen.com` — it 301-redirects to `www`, and
Android's App Link verifier does **not** follow redirects. Filled in with the debug SHA-256 above:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.zhaostephen.szmde",
    "sha256_cert_fingerprints": [
      "7F:EC:74:94:03:C8:D8:88:5B:6A:CD:07:77:4D:C2:45:89:31:32:7D:B8:8C:6B:07:54:4E:69:03:19:F9:63:48"
    ]
  }
}]
```

When you ship, append the **release** SHA-256 as a second string in that array. Details + gotchas:
[m6-plan.md § App Link setup (decision 2)](m6-plan.md).

## Step 2 — Create the Android OAuth client (Google Cloud Console)

In the **same** Google Cloud project as the existing desktop client, create a **new** OAuth client of
type **Android** (the desktop client cannot be reused — Google requires one client per platform):

- **Package name:** `com.zhaostephen.szmde`
- **SHA-1 certificate fingerprint:** the **debug** SHA-1 above. An Android OAuth client is keyed to a
  single (package, SHA-1) pair, so **create one client per certificate** — the debug client now, and a
  **second** Android client with the **release** SHA-1 when you ship.
- **Authorized redirect:** `https://www.zhaostephen.com/szmde/oauth2redirect` (the `www` App-Link host
  from Step 1)

Copy the resulting **client ID** (`…apps.googleusercontent.com`) for Step 3. Two clients ⇒ two client
IDs, so `gdrive_client.json` differs per build (debug vs release) — push the matching one; for device
testing use the **debug** client's ID. Cloud Console navigation is the same as the desktop walkthrough
in [m3-cloud-setup.md § 1](m3-cloud-setup.md) — only the client *type* (Android, package + SHA-1) differs.
_(If Google rejects the https App-Link redirect on an Android client, the fallback is a single **Web
application** client keyed by the redirect URI, with the SHA-1s living only in `assetlinks.json` — we'll
confirm which at the Part B test.)_

## Step 3 — Provide `gdrive_client.json`

szmde reads its client config from `<app_config_dir>/gdrive_client.json`. Shape (template:
[src-tauri/gdrive_client.example.json](../src-tauri/gdrive_client.example.json)) — **`client_secret`
is empty** on Android (pure PKCE, public client):

```json
{
  "client_id": "<the Android client ID from Step 2>.apps.googleusercontent.com",
  "client_secret": ""
}
```

On Android the config dir is **app-private**, so this can't just be dropped in a folder — it's pushed
onto the device with `adb push` + `run-as com.zhaostephen.szmde` (works on debug builds). The exact
path is logged from the device during WF-33 Part B, so **leave this to the Part B run** — just have the
client ID ready.

## Step 4 — (shipping only) Upload keystore + release cert

Not needed for device testing; do this when you're ready to ship a signed build. Generate the
`szmde-upload.jks` upload keystore, set the three `ANDROID_KEY_*` repo secrets, then read its SHAs
(command above) and **add them** to `assetlinks.json` (Step 1) and the OAuth client (Step 2). Full
runbook: [ci-cd.md § Android signing — the upload keystore](ci-cd.md).

## Then: run WF-33 Part B

Once Steps 1–3 are live (debug cert) and the Pixel has network, the on-device flow can run: **Connect
Google Drive… → system-browser Custom Tab → sign in → the App Link returns to the app → token persists
in the Keystore → kill+relaunch reconnects (refresh) → read/write a known Drive file**. Full script:
[llm-workflow-tests.md § WF-33](llm-workflow-tests.md).

## Checklist

- [ ] `assetlinks.json` live at `https://www.zhaostephen.com/.well-known/assetlinks.json` with the debug SHA-256
- [ ] Android OAuth client created (package `com.zhaostephen.szmde` + debug SHA-1 + the redirect)
- [ ] Android client ID ready for `gdrive_client.json` (pushed during the Part B run)
- [ ] _(shipping)_ upload keystore generated, secrets set, release SHAs appended to the two above
