# M6 — Android (implementation plan)

_Implementation plan for milestone **M6** (see [roadmap.md](roadmap.md) "M6" for the requirement
slotting and [SPEC.md](../SPEC.md) §2 / §6 / §7 for the behavior). SPEC.md is the "what"; this doc is
the "how" — architecture + staged `S<n>` slices. Same shape as the archived m1–m5 plans. Grounded by a
cited research pass (2026-07-18); every device-dependent claim is flagged for on-device verification._

_Status legend: ✅ done · 🔜 next · ⬜ planned._

## Scope (from roadmap "M6" / SPEC §2)

Make szmde run as a **native Android app** on Tauri 2 mobile (GA since 2024-10-02; the local CLI
2.11.3 already ships `tauri android {init,dev,build,run}`). Three requirements:

| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-MOBILE-1 | Tauri 2 Android build → installable APK/AAB | §2 |
| REQ-MOBILE-2 | Responsive UI from desktop windows down to phone widths (touch, soft keyboard, safe-areas) | §7 |
| REQ-MOBILE-3 | Storage Access Framework / scoped-storage backend (open/save real device files) | §6 |

**Guiding principle — local-first.** Prove the app *boots*, make it *phone-usable*, ship a fully
**offline** Android editor that opens/saves real files via SAF, cut a *signed* build — and only then
port **Drive sign-in**. M6 is shippable as a local-only Android editor; cloud is additive.

**Scope (decided 2026-07-18):** M6 = **S1–S6** (local-first + Drive sign-in). The native Drive
**Picker** (opening *pre-existing* Drive files, was S7) is **deferred to M6.1** — the highest-uncertainty
item. **Distribution** for M6 is a **sideload signed APK**; the **Play Store** release is its own later
milestone (**REQ-PLAY-1**). The Android OAuth redirect is an **https App Link**. See
[Decisions](#decisions-resolved-2026-07-18--stephen).

## The big shift: three desktop seams carry over, their tails change

szmde's M3 architecture already isolated the platform-specific bits behind three seams, so **most of
the app is reused unchanged** and Android only adds new backends behind them:

| Seam (shared, unchanged) | Desktop tail | Android tail (new) |
|--------------------------|--------------|--------------------|
| `StorageProvider` (`src/lib/storage/provider.ts`) | `LocalProvider` → Rust `read_file_meta`/`write_file` over `std::fs` **paths** | `SafProvider` over SAF `content://` URIs (scoped storage) |
| OAuth core (`oauth.ts`, `cloud-http.ts`, `tauri-transport.ts` — PKCE, token exchange/refresh, Drive REST) | `127.0.0.1` loopback capture (`oauth_loopback_await`, `oauth_pick_await`) | **deep-link** redirect capture (`tauri-plugin-deep-link`) |
| `SecureStore` (`secure-store.ts` → Rust `secure_*` via `keyring`) | Windows Credential Manager (`keyring` v3) | Android Keystore (`keyring` **v4** `android-native-keyring-store`) |

The Rust entry point needs **no restructuring**: `lib.rs` already has
`#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`, `main.rs` just calls it, and
`Cargo.toml` already declares `crate-type = ["staticlib","cdylib","rlib"]`. `tauri-plugin-single-instance`
is already desktop-gated.

---

## Prerequisites — YOUR toolchain setup (before S1)

The assistant **cannot** do these (they need the Android SDK + your machine + Google/Play accounts).
szmde is the documented **Windows-native** exception to the WSL-first rule, so set these up
Windows-native. Current machine state: **Java 1.8 (too old)**, no `ANDROID_HOME`/`NDK_HOME`, no NDK, no
rustup Android targets, no `src-tauri/gen/android`.

1. **Android Studio** → SDK Manager: install *SDK Platform* (**API 36** — we compile/target 36),
   *Platform-Tools*, *Build-Tools*, *Command-line Tools*, and *NDK (Side by side)* — **NDK r28+ is
   required** for the 16 KB memory-page support that Android 16 / Play enforce. Accept licenses
   (`sdkmanager --licenses`) or Gradle fails.
2. **JDK 17** with `JAVA_HOME` pointing at it (Android Studio's bundled JBR works). Java 1.8 errors
   with *"Android Gradle plugin requires Java 17"*; **do not** use JDK 21/26 (they conflict with
   Tauri's bundled Gradle 8.14.x).
3. **Env vars** (Windows PowerShell, per Tauri docs — missing `NDK_HOME` is a very common `init` failure):
   ```powershell
   [System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LocalAppData\Android\Sdk", "User")
   $VERSION = Get-ChildItem -Name "$env:LocalAppData\Android\Sdk\ndk" | Select-Object -Last 1
   [System.Environment]::SetEnvironmentVariable("NDK_HOME", "$env:LocalAppData\Android\Sdk\ndk\$VERSION", "User")
   ```
4. **Rust targets:** `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
5. **A test device:** an AVD (e.g. Pixel, API 35/36 x86_64) and/or a physical phone with USB debugging
   (needed for the on-device slices S3 keyboard/IME, S6 keystore/deep-link).
6. **(Cloud, S6/S7)** In Google Cloud Console, create a **separate Android OAuth client** for
   `com.zhaostephen.szmde` keyed by the **debug AND release SHA-1** (`keytool -list -v -keystore …`).
   The existing Windows *Desktop* client cannot be reused (Google requires one client per platform).
7. **(Release, S5)** Generate an upload keystore once, kept out of git:
   `keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`.

---

## Architecture decisions

1. **Storage seam — shared interface, new backend.** `StorageProvider` (read/write/stat, `Revision`,
   `StorageError` taxonomy) does **not** change. The desktop `LocalProvider` (raw `std::fs` paths) still
   *compiles* for Android but hits the scoped-storage sandbox at runtime, so it isn't used for user
   documents there. Add a **`SafProvider`** whose `path` is a SAF `content://` URI string, register it
   in `ProviderRegistry` conditionally on platform so open/save call sites and
   `settings.storage.defaultProvider` stay untouched (recommend it keep the id `"local"`).
2. **SAF revision model — mirror the local rev.** `LocalProvider` composes `rev = {mtime_nanos}-{len}`;
   `SafProvider` composes `rev = {DocumentFile.lastModified()}-{length}`, so REQ-SAVE-1 conflict
   detection works verbatim. If `lastModified` proves unreliable across SAF document providers, degrade
   `capabilities.conflictDetection = false` (the shell already tolerates a null baseline rev) rather
   than corrupt the check-and-set.
3. **SAF mechanism — prefer existing plugins, hand-write Kotlin only if needed.** On Android
   `tauri-plugin-dialog`'s `open()`/`save()` invoke the SAF picker and return a `content://` URI;
   `tauri-plugin-fs` can read/write that URI via `FilePath::Url` (it **cannot** list a directory or
   create-in-directory from a URI — fine, szmde opens/saves single files). The gap is **persistable
   permissions** (`takePersistableUriPermission`, for re-open across launches) and `DocumentFile`
   metadata (the rev token); the community **`tauri-plugin-android-fs`** (aiueo13) covers both
   (`Picker` + `AndroidFs` APIs) but is young (no tagged releases — vet it). **S4 spikes the
   official dialog+fs path first**, then adds `tauri-plugin-android-fs` or a minimal custom Kotlin
   plugin for persistence + metadata.
4. **Settings storage — no SAF.** `user.json`/settings live in app-private storage (SPEC §8), writable
   with plain `std::fs` — no picker. Give the settings backend a mobile path targeting Tauri's
   app-config dir; SAF is only for user-chosen document files.
5. **OAuth — shared core, new redirect capture.** PKCE, token exchange/refresh, and Drive REST over
   plugin-http are unchanged. The `127.0.0.1` loopback is **invalid on Android** (Google deprecated
   loopback for mobile; custom URI schemes default-disabled for new Android clients since 2023-10-02).
   On mobile, the redirect is a **deep link** captured by `tauri-plugin-deep-link` v2
   (`onOpenUrl`/`getCurrent`), the auth launched in a Chrome Custom Tab; `gdrive-connect.ts`'s
   `redirectUri` is mobile-gated to the deep-link URL. Requires the separate Android OAuth client.
6. **Drive Picker — new native path, highest uncertainty.** The desktop Picker (`trigger_onepick` over
   the loopback, `oauth_pick_await` → `picked_file_ids`) can't fire on Android. The Android Picker is a
   native Google Identity Services `AuthorizationRequest` with the `PICKER_OAUTH_TRIGGER` resource
   (Kotlin — likely a second custom plugin) returning `picked_file_ids` to the deep-link redirect;
   `drive.file`-only. **Deferred to M6.1** (out of the M6 line — decision 1, 2026-07-18).
7. **Secure store — shared contract, Cargo bump only.** `secure_*` + `TauriSecureStore` stay
   byte-for-byte. Bump `keyring = { version = "3", features = ["apple-native","windows-native"] }` →
   `keyring = "4"` (v4's default feature covers Windows/Apple/Linux; the companion
   `android-native-keyring-store` — Android-Keystore-encrypted SharedPreferences over JNI, minSdk 24 —
   auto-registers under `cfg(target_os="android")`). **This bump is required even to cross-compile for
   Android** (v3 has no Android backend). Do **not** use Stronghold (deprecated) or androidx
   `EncryptedSharedPreferences` (deprecated 2025-04); fallback is `tauri-plugin-keyring` v0.2.0.
8. **Responsive — shared CSS shell, additive.** The shell already sizes with `100dvh` and a bare
   viewport meta. Add `interactive-widget=resizes-content` + `viewport-fit=cover` (since Chromium 108
   the soft keyboard resizes only the *visual* viewport, so `dvh`/`svh` don't shrink for it —
   `resizes-content` shrinks the *layout* viewport so CM6's caret scrolls into view). Add a phone
   (`<600px`) breakpoint collapsing the sidebar/`HamburgerMenu` into a drawer, ≥48dp tap targets,
   `touch-action:manipulation`, `overscroll-behavior:none`, and `env(safe-area-inset-*)` wrapped in
   `max(…, fallback)` (env() returns 0 on WebView <M136; **targetSdk 36 / Android 16 makes edge-to-edge
   mandatory** — no opt-out — which is exactly why we handle insets rather than opt out).
   Keep CM6 **contenteditable-native** selection (do not override `contentAttributes` in ways that break
   native touch selection/IME).
9. **Rust cfg gating — one `run()`, two modes.** Gate the CLI launcher (`parse_cli`/`env::args`/
   `LaunchFile`) and the loopback OAuth commands under `#[cfg(desktop)]` (no launch args / no loopback
   on mobile); add `#[cfg(mobile)]` registrations for the deep-link + SAF/Picker plugins.

## Per-REQ impact

- **REQ-MOBILE-1** — toolchain + `keyring` 3→4 (to cross-compile) + `cfg(desktop)`-gate the CLI +
  `tauri android init` (commit `src-tauri/gen/android`; it ships nested `.gitignore`s that exclude only
  build artifacts). `tauri android dev` boots the static SvelteKit SPA in the WebView with **no frontend
  rewrite** (adapter-static + `ssr=false` + `frontendDist:"../build"` already in place; only the Vite
  dev server must bind to `TAURI_DEV_HOST`/`0.0.0.0` for device HMR). `tauri android build` (no flag) →
  both APK + AAB; release AAB at `gen/android/app/build/outputs/bundle/universalRelease/…-release.aab`,
  unsigned release APK at `…/apk/universal/release/…-release-unsigned.apk`. minSdk default 24 via
  `bundle.android.minSdkVersion`.
- **REQ-MOBILE-2** — additive CSS on the shared shell (see architecture #8). Highest risk: CM6 caret
  visibility next to inline widgets during IME composition + the soft-keyboard layout-viewport behavior
  — both need real-device proof.
- **REQ-MOBILE-3** — the core M6 deliverable: `SafProvider` + the SAF plugin path (architecture #1–3).
- **REQ-SEC-1 (parity on Android)** — `keyring` 3→4 only; contract unchanged; verify auto-registration +
  ndk-context on device.
- **REQ-CLOUD-1 (parity on Android)** — deep-link redirect + separate Android OAuth client; PKCE/refresh/
  Drive REST unchanged. Enables sign-in + read/write of already-known file IDs.
- **REQ-CLOUD-3 (parity on Android)** — native GIS Picker (`PICKER_OAUTH_TRIGGER`); **deferred to M6.1**
  (decision 1), out of the M6 line.
- **REQ-CLOUD-2 (OneDrive)** — out of M6 scope (already deferred/backend-only).

## Staged slices

| Slice | Title | REQ | Acceptance |
|-------|-------|-----|-----------|
| **S1** | Boots on emulator (toolchain + `android init` + cross-compile) | REQ-MOBILE-1 | Provision the toolchain; bump `keyring` 3→4; `cfg(desktop)`-gate the CLI; `tauri android init` + commit `gen/android`; set minSdk 24 (compileSdk/targetSdk 36 are the template default — no edit). **`tauri android dev` launches the blank editor in an emulator; `cargo build` succeeds for all 4 ABIs; desktop `tauri dev` + `npm test` still green.** No storage/cloud/keyboard yet. |
| **S2** | Responsive shell down to phone width | REQ-MOBILE-2 | Viewport meta + phone `<600` breakpoint (drawer), ≥48dp targets, safe-area insets. **Toolbar/drawer/editor usable by touch on a phone-sized emulator, no horizontal overflow, content clears system-bar insets; desktop layout unchanged.** Soft keyboard deferred to S3. |
| **S3** | Soft-keyboard + IME correctness (on-device) | REQ-MOBILE-2 | `interactive-widget=resizes-content` + a `visualViewport` fallback; verify CM6 caret next to widgets + IME. **Typing a paragraph, editing a table cell / task item, and IME composition keep the caret visible above the keyboard on a physical phone.** |
| **S4** | SAF local storage backend (offline open/save) | REQ-MOBILE-3 | Spike dialog+fs (`content://` via `FilePath::Url`); add `SafProvider` + persistable permissions + `DocumentFile` rev; settings via app-private `std::fs`. **On-device: pick a real `.md`, edit, save back (with conflict detection), reopen after app restart via the persisted URI — fully offline.** The milestone's core shippable. |
| **S5** | Signed release AAB/APK + Android CI | REQ-MOBILE-1 | Upload keystore + `signingConfigs`; a GitHub Actions job (setup-java 17 + SDK/NDK + the 4 targets, keystore from base64 secrets) building `--apk`/`--aab`. **CI produces a signed APK installable on a device + a signed AAB.** A local-only Android szmde is shippable here. |
| **S6** | Cloud sign-in on Android (deep-link OAuth + keystore verify) | REQ-CLOUD-1 | Verify `keyring` v4 round-trip on device; add `tauri-plugin-deep-link` + the redirect (App Link recommended) + separate Android OAuth client; mobile-gate `gdrive-connect.ts`. **`connectGoogleDrive` completes in a Custom Tab, tokens persist in the Keystore, refresh works, read/write of a known Drive file ID succeeds.** |
| **S7 → M6.1** | Android Drive Picker (open pre-existing files) — **deferred out of M6** (decision 1) | REQ-CLOUD-3 | Native GIS `AuthorizationRequest` Kotlin plugin (`PICKER_OAUTH_TRIGGER`, `drive.file`) → `picked_file_ids` via deep link; mobile-gate `pickGoogleDriveFiles`. **On-device: pick a pre-existing Drive file via the native Picker and open it read/write.** Highest uncertainty — lands in **M6.1**, after the M6 local + Drive-sign-in line ships. |

## Risks (need on-device verification)

1. **Cross-compile is risk #1** — whether the existing desktop Rust actually builds for
   `aarch64-linux-android` after cfg-gating; the `keyring` 3→4 bump is a hard prerequisite just to
   compile. A real `cargo build` per ABI is the S1 gate.
2. `keyring` v4 Android auto-registration + ndk-context init unverified on device (fallback:
   `tauri-plugin-keyring`).
3. CM6 caret invisible next to inline widgets during IME composition (widget-heavy editor) — physical
   device + real IME only.
4. Soft keyboard: whether `interactive-widget=resizes-content` shrinks the layout viewport and whether
   `visualViewport.height` updates for the OSK (Tauri #10631 open: doesn't; #7868: inconsistent).
5. `env(safe-area-inset-*)` returns 0 on WebView <M136; **targetSdk 36 / Android 16 makes edge-to-edge
   mandatory (the opt-out is dead)** — needs a JS/native inset fallback across WebView versions. (We
   handle insets rather than opt out, so targeting 36 adds no work here.)
6. **Resolved:** the SDK level needs **no hand-edit** — Tauri's `gen/android/app/build.gradle.kts`
   template already defaults `compileSdk = 36` + `targetSdk = 36` (AGP 8.11.0 + Gradle 8.14 support it),
   so only `minSdk` is set (via `tauri.conf.json`, not a Gradle hand-edit). Re-confirm the defaults hold
   after `init`, since a future Tauri version could change the template.
7. SAF durability: persisted URI permissions surviving restarts + `DocumentFile.lastModified()` as a
   trustworthy rev across document providers (may degrade `conflictDetection=false`).
8. Deep-link redirect capture (`onOpenUrl` vs `getCurrent` cold-start) + the native GIS Picker have thin
   precedent — highest-uncertainty cloud items.
9. `tauri-action` Android support is **experimental** — pin the version and confirm the mobile input, or
   hand-roll the Gradle+signing CI job.

## Decisions (resolved 2026-07-18 — Stephen)

1. **Scope of M6 → local + Drive sign-in; the Picker is deferred to M6.1.** M6 ships **S1–S6** (a
   local-first Android editor + Google Drive sign-in and read/write of already-known file IDs). Opening
   *pre-existing* Drive files via the native GIS Picker (was S7) becomes **M6.1** — the
   highest-uncertainty item, cut from the M6 line.
2. **Android redirect → https App Link** (not a custom URI scheme). Stephen hosts the verification file;
   setup below (§ [App Link setup](#app-link-setup-decision-2)).
3. **SAF → spike the official `tauri-plugin-dialog` + `tauri-plugin-fs` path first** (content:// via
   `FilePath::Url`), before reaching for `tauri-plugin-android-fs` or a custom Kotlin plugin — add those
   only for what the official path can't do (persistable permissions / `DocumentFile` metadata).
4. **Distribution → sideload signed APK for M6.** The Play Store (AAB + Console + review) is kept open
   as its **own later milestone** — a real requirement (**REQ-PLAY-1**), not part of M6. See
   [roadmap.md](roadmap.md).
5. **SDK levels → minSdk 24, compileSdk/targetSdk 36** (Android 16). _Updated 2026-07-19 (was
   targetSdk 35)._ **36 is Tauri's out-of-the-box template default** — `gen/android/app/build.gradle.kts`
   hardcodes `compileSdk = 36`/`targetSdk = 36`, and Tauri's bundled **AGP 8.11.0 + Gradle 8.14** clear
   the compileSdk-36 minimum (AGP ≥ 8.9.1 / Gradle ≥ 8.11.1). So there's **no `gen/android` hand-edit**
   for the SDK level — only `minSdk` (via `tauri.conf.json > bundle.android.minSdkVersion`). Chosen over
   35 because: (a) we handle insets rather than opt out, so Android 16's mandatory edge-to-edge adds no
   work; (b) NDK r28+ already covers the 16 KB page rule Android 16 wants; (c) it matches the installed
   platform (android-36). Re-confirm the template default holds after `init`.

### App Link setup (decision 2)

The OAuth/Picker redirect on Android is an **https App Link** that Android verifies (via a hosted
`assetlinks.json`) and routes into szmde, so the Custom Tab returns to the app. One-time setup, split
between you and the code:

**You — hosting + Cloud Console:**
1. Host a static file at **`https://zhaostephen.com/.well-known/assetlinks.json`** (real HTTPS,
   `Content-Type: application/json`, no redirect) authorizing the app to handle the domain's links:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.zhaostephen.szmde",
       "sha256_cert_fingerprints": ["<DEBUG SHA-256>", "<RELEASE SHA-256>"]
     }
   }]
   ```
   Get the SHA-256s from `keytool -list -v -keystore <keystore>` — for **both** the debug keystore
   (usually `~/.android/debug.keystore`, password `android`) and your release upload keystore.
2. In the **Android OAuth client** (Cloud Console), set the redirect to a path under that verified
   domain, e.g. `https://zhaostephen.com/szmde/oauth2redirect`. (No "Advanced Settings" toggle — that's
   only for the custom-URI-scheme option we're not using.)

**The code (S6):** `tauri-plugin-deep-link` in `tauri.conf.json > plugins > deep-link`:
`{"mobile":[{"scheme":["https"],"host":"zhaostephen.com","pathPrefix":["/szmde"],"appLink":true}]}` —
the plugin emits the intent filter with `android:autoVerify="true"`, and `onOpenUrl` captures the
redirect (`code`/`picked_file_ids`). `gdrive-connect.ts`'s `redirectUri` is mobile-gated to the App
Link URL.

_Gotcha: verification only succeeds once `assetlinks.json` is live AND the installed app's signing-cert
SHA-256 is listed — validate with the debug cert first, add the release cert before shipping._

## Process

Built requirements move into [requirements.md](requirements.md) with linked tests as each slice lands;
device-only behavior (keyboard/IME, SAF round-trip, deep-link capture) gets an LLM workflow in
[llm-workflow-tests.md](llm-workflow-tests.md) run on a real device/emulator. Run the adversarial
"ultracode" review on substantial slices before merge.

## References (fetched 2026-07-18)

- Tauri mobile prerequisites / build / distribute: <https://v2.tauri.app/start/prerequisites/> · <https://v2.tauri.app/distribute/> · <https://v2.tauri.app/blog/tauri-20/>
- Deep linking: <https://v2.tauri.app/plugin/deep-linking/> · <https://docs.rs/crate/tauri-plugin-deep-link/latest>
- Google OAuth for native apps (loopback deprecated on mobile; custom-scheme restriction): <https://developers.google.com/identity/protocols/oauth2/native-app> · <https://developers.googleblog.com/en/improving-user-safety-in-oauth-flows-through-new-oauth-custom-uri-scheme-restrictions/>
- Google Picker desktop & mobile: <https://developers.google.com/workspace/drive/picker/guides/overview-desktop>
- keyring Android backend: <https://deepwiki.com/open-source-cooperative/keyring-rs/5.4-android-keystore> · <https://docs.rs/android-native-keyring-store>
- SAF / scoped storage in Tauri: <https://v2.tauri.app/plugin/file-system/> · <https://github.com/aiueo13/tauri-plugin-android-fs> · <https://crates.io/crates/tauri-plugin-scoped-storage>
- Responsive/keyboard/insets: <https://developer.chrome.com/blog/viewport-resize-behavior> · <https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets> · <https://github.com/tauri-apps/tauri/issues/10631>
