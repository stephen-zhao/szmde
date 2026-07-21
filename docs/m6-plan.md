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

**Follow-ons (parked out of the M6 line):** **M6.1** = the native Drive Picker. **M6.2** =
the [Touch UX pass](#m62--touch-ux-pass) (`REQ-UI-4`, `REQ-TBLED-8/9`), scoped 2026-07-20 from the
first on-device review. Framing that matters: **M6 makes szmde _run_ on Android; M6.2 makes it
_usable_.** M6's acceptance is deliberately "boots, is responsive, opens/saves files" — a shipped
feature being *unreachable* by touch (Find, table editing) is out of M6's scope but is squarely M6.2's.

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
Windows-native. _Provisioned 2026-07-19 (S1): JDK 17 + `JAVA_HOME`, `ANDROID_HOME`/`NDK_HOME`, NDK 30, all
4 rustup Android targets, and a committed `src-tauri/gen/android`. Still pending for on-device work:
**Windows Developer Mode** (Tauri symlinks the built `.so` into `jniLibs` — the build fails without it) and
an **AVD/physical device**._

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
   `keyring = "4"`. **This bump is required even to cross-compile for Android** (v3 has no Android
   backend). ⚠️ **Corrected 2026-07-19 (S1, on device):** v4's default `v1` feature covers
   **Windows/Apple/Linux only** — the resolved tree has `apple-native` / `windows-native` /
   `zbus-secret-service` stores and **no Android store**, and the companion
   `android-native-keyring-store` (Android-Keystore-encrypted SharedPreferences over JNI, minSdk 24)
   does **NOT** auto-register. It must be added as an explicit `cfg(target_os="android")` dependency
   **and registered as keyring-core's default store**; otherwise every `secure_*` call fails at runtime
   (see risk #2). Do **not** use Stronghold (deprecated) or androidx
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
| **S3** ✅ | Soft-keyboard + IME correctness (on-device) | REQ-MOBILE-2 | **Done 2026-07-20.** The planned CSS-only route (`interactive-widget=resizes-content` + `visualViewport`) could not work as specced — see risk #4 — so it shipped as a **native IME-inset bridge** in `MainActivity.kt` publishing `--kb-inset`, with CSS shrinking `.app` and lifting `.statusbar`. **Verified on a physical Pixel 9 Pro:** `--kb-inset` 373px, `.app` 952→579, statusbar 32→381px, and after typing 18 lines the caret sits at y=578 in a 579px visible area. _Not yet exercised: IME **composition** (CJK/predictive) next to inline widgets, and table-cell editing with the keyboard up — carry into S4/M6.2 testing._ |
| **S4** | SAF local storage backend (offline open/save) | REQ-MOBILE-3 | Spike dialog+fs (`content://` via `FilePath::Url`); add `SafProvider` + persistable permissions + `DocumentFile` rev; settings via app-private `std::fs`. **On-device: pick a real `.md`, edit, save back (with conflict detection), reopen after app restart via the persisted URI — fully offline.** The milestone's core shippable. |
| **S5** | Signed release AAB/APK + Android CI | REQ-MOBILE-1 | Upload keystore + `signingConfigs`; a GitHub Actions job (setup-java 17 + SDK/NDK + the 4 targets, keystore from base64 secrets) building `--apk`/`--aab`. **CI produces a signed APK installable on a device + a signed AAB.** A local-only Android szmde is shippable here. |
| **S6** | Cloud sign-in on Android (deep-link OAuth + keystore verify) | REQ-CLOUD-1 | Verify `keyring` v4 round-trip on device; add `tauri-plugin-deep-link` + the redirect (App Link recommended) + separate Android OAuth client; mobile-gate `gdrive-connect.ts`. **`connectGoogleDrive` completes in a Custom Tab, tokens persist in the Keystore, refresh works, read/write of a known Drive file ID succeeds.** |
| **S7 → M6.1** | Android Drive Picker (open pre-existing files) — **deferred out of M6** (decision 1) | REQ-CLOUD-3 | Native GIS `AuthorizationRequest` Kotlin plugin (`PICKER_OAUTH_TRIGGER`, `drive.file`) → `picked_file_ids` via deep link; mobile-gate `pickGoogleDriveFiles`. **On-device: pick a pre-existing Drive file via the native Picker and open it read/write.** Highest uncertainty — lands in **M6.1**, after the M6 local + Drive-sign-in line ships. |

## M6.2 — Touch UX pass

_Scoped 2026-07-20 from Stephen's first on-device Android review. Parked out of the M6 line so the
local-first S1–S6 ships first._

**One root cause.** szmde's interaction model was built for a **fine pointer (hover + right-click) and
a keyboard**. On a coarse pointer those inputs simply don't exist, so affected features don't degrade
gracefully — they become **completely unreachable**. Every gap below was verified in code, not assumed:

| Assumed input | Where it's load-bearing | Consequence on touch |
|---------------|-------------------------|----------------------|
| Keyboard (`Mod-f`) | Find & Replace has **no** hamburger entry — only `searchKeymap` | REQ-FR-1 (shipped M4) **cannot be opened at all** |
| `:hover` | Table insert/delete gizmos are `display:none` until `th:hover`/`td:hover`; drag handles hover-revealed (`theme.ts`) | gizmos **never appear** |
| Right-click | Table action menu is bound to `contextmenu` (`tables.ts`, `table-source-gizmos.ts`) | menu **never opens** |
| Content width | Cell size is content-driven; `tables.ts` sets no min width/height | an empty N×M scaffold **collapses to untappable slivers** |

### Slices

| Slice | Title | REQ | Acceptance |
|-------|-------|-----|-----------|
| **T1** | Command reachability (Find entry + audit) | REQ-UI-4 | Add **Find & Replace** to the hamburger, then audit the *whole* command surface for keyboard-/hover-/right-click-only paths and give each a pointer-agnostic entry. **On a touch-only device every shipped command can be invoked without a keyboard, hover or right-click.** ⚠️ Do T1's Find entry **together with** the `.cm-panels-top` inset below — opening Find on a phone is what first *exposes* that bug. |
| **T2** | Empty tables/cells stay targetable | REQ-TBLED-8 | Minimum rendered cell width/height + visible empty-cell boundaries + placeholder affordances for empty cells/rows/columns. **A freshly inserted N×M scaffold is visible and tappable before anything is typed**, on both pointer types. Also re-size the `TableSizePicker` grid cells (16×16px today, hover-only preview). |
| **T3** | Coarse-pointer table structural editing | REQ-TBLED-9 | The redesign: a touch-first path to insert/delete/move rows+columns (e.g. tap-to-select-cell → persistent action bar, or long-press → action sheet), with hover/right-click kept as a fine-pointer *enhancement*, not the only route. **Every REQ-TBLED-3/4/5 action is reachable by touch alone on a phone.** Largest slice — treat as its own design spike first. |

### Also folded into M6.2 (open findings from the S2 adversarial review, 2026-07-20)

- **`.cm-panels-top` has no top safe-area inset** — the Find panel lays out at viewport y=0, inside the
  measured 52px status-bar band. Currently masked because Find is keyboard-only; **T1 unmasks it**, so
  fix both together. Belongs on `.cm-panels.cm-panels-top` (additive `env()` padding), *not* on
  `.cm-editor`/`.app` — insetting the container would double-count against `.cm-content`'s top padding.
- **Conflict-modal action row overflows at ≤375px** — the primary "Overwrite" button can be clipped
  off-screen at small display sizes.
- **Text scrolls under the status bar** — `.cm-content`'s top padding clears the *first* screen only
  (M6 S2). A genuine design call for M6.2: immersive edge-to-edge vs. inset content.

_Reviewed and **accepted as-is by Stephen** (2026-07-20) — not defects, do not "fix" without asking:
the current control sizes, i.e. status chips at 34px and dropdown / chip-menu rows at 44px, below the
≥48dp guidance._

## Risks (need on-device verification)

1. **Cross-compile is risk #1** — whether the existing desktop Rust actually builds for
   `aarch64-linux-android` after cfg-gating; the `keyring` 3→4 bump is a hard prerequisite just to
   compile. A real `cargo build` per ABI is the S1 gate.
2. ⚠️ **CONFIRMED on device (2026-07-19, S1) — this risk materialized.** `keyring` v4 does **not**
   auto-register an Android store. The app boots fine, but any `secure_*` call rejects at runtime with
   _"No default store has been set, so cannot search or create entries"_ (seen in logcat as
   `E Tauri/Console` on first launch, from the startup Drive-connection check). **Fix (S6):** add
   `android-native-keyring-store` as a `cfg(target_os="android")` dependency and register it as the
   default store, then verify the round-trip on device. Fallback remains `tauri-plugin-keyring`.
3. CM6 caret invisible next to inline widgets during IME composition (widget-heavy editor) — physical
   device + real IME only.
4. ✅ **RESOLVED (S3, 2026-07-20) — but read the correction below before trusting any of it.**
   **What is true, measured on a PHYSICAL Pixel 9 Pro / Android 16 with a real docked keyboard:**
   `interactive-widget=resizes-content` does **not** resize the layout viewport — `innerHeight` stays
   952 with the IME up (confirms Tauri #10631). `android:windowSoftInputMode="adjustResize"` is **also**
   inert, because a targetSdk 35+ edge-to-edge app no longer gets automatic IME resizing; it must
   consume `WindowInsets.ime()` itself. So `100dvh` alone can never shrink for the keyboard.
   **Shipped fix:** a native bridge in `MainActivity.kt` (editable + committed; `TauriActivity.kt` is
   auto-generated — don't touch) overriding `WryActivity.onWebViewCreate` to publish the IME inset as
   CSS `--kb-inset`, via a `WindowInsetsAnimation` callback. CSS shrinks `.app` by it (so CodeMirror
   gets a correct visible height and its own caret `scrollIntoView` works) and lifts `.statusbar`.
   `adjustResize` is kept for API 24–34, where the framework still resizes and `--kb-inset` stays 0.
   **Verified on device:** `--kb-inset` 373px, `.app` 952→579, `.cm-scroller` 579, statusbar bottom
   32→381px; after typing 18 lines the active line sits at y=578 inside a 579px visible area, i.e. the
   caret stays above the keyboard (the S3 acceptance).

   ⚠️ **TWO FALSE LEADS — recorded so nobody re-derives them.**
   (a) *"`visualViewport` is inert too"* — **WRONG.** It reports 952→**578** on the phone (≈ the same
   373px), so the plan's original Plan B does work. (b) *"`env(safe-area-inset-*)` returns 0 on physical
   hardware while the AVD says 52"* — **WRONG, and self-inflicted.** Both came from the same mistake:
   registering `ViewCompat.setOnApplyWindowInsetsListener` **on the WebView**, which REPLACES the
   WebView's own inset handling — precisely how Chrome derives `env()` *and* updates `visualViewport`.
   It silently zeroed both, and presented convincingly as a device/emulator platform difference. Moving
   the listener to the **decorView** restores both (`env` 68px top / 24px bottom on the phone).
   **Rule: never attach an apply-insets listener to the Tauri WebView.**
   Also note the AVD is a poor IME test rig at all: with a hardware keyboard attached it shows Gboard's
   *floating* mini-toolbar, which occludes nothing, so `ime=0` there is correct and meaningless.
   **Follow-up (deliberately deferred, Stephen 2026-07-20):** since `visualViewport` does work, the ~40
   lines of Kotlin could likely be replaced by ~4 lines of TS
   (`visualViewport.addEventListener('resize', ...)` → set `--kb-inset`), which would also cover
   web/PWA. Not swapped now: S3's acceptance is already met and demonstrable, and changing the
   mechanism deserves its own tested change (100%-coverage gate applies) rather than being smuggled in
   at the end of the slice.
5. ✅ **RESOLVED (S3, 2026-07-20) — `env()` works; the danger is CLOBBERING it.** Measured with the
   apply-insets listener correctly on the decorView: `env(safe-area-inset-top)` = **52px** on the AVD and
   **68px** on a physical Pixel 9 Pro (bottom 24px = the gesture bar). So the S2 CSS inset strategy is
   sound and **no native safe-area bridge is needed** — an earlier `--sat/--sab` bridge was built on the
   false premise in risk #4(b) and has been reverted. targetSdk 36 still makes edge-to-edge mandatory,
   which is why we handle insets rather than opt out. The one real hazard is documented in risk #4:
   attaching an apply-insets listener to the **WebView** zeroes `env()` on all four edges.
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
