# CI/CD & branch workflow

GitHub Actions: a **CI** gate on every change, a path-filtered **Android** build check,
and a **Release** build on version tags.
All live in [`.github/workflows/`](../.github/workflows/). See [INDEX.md](INDEX.md) for the
doc map.

## CI — `.github/workflows/ci.yml`

Runs on **every push to `main`** and **every pull request**. Mirrors the local gate, so a
green PR == a green `npm run check && npm run build && npm run test:coverage && npm run test:trace`
plus the Rust checks. Two jobs:

| Job | Runner | Steps |
|-----|--------|-------|
| **gate** | ubuntu-latest | `npm ci` → `check` (svelte-check, 0 errors) → `build` (prod Vite build) → `test:coverage` (vitest; **fails under 100% lines** — `vitest.config.ts` threshold) → `test:trace` (requirement↔test) |
| **rust** | windows-latest | `cargo fmt --check` → `cargo clippy --all-targets -- -D warnings` → `cargo test` (in `src-tauri/`) |

The rust job runs on Windows because that's the release target (WebView2 preinstalled); the
frontend gate runs on Linux because the tests are platform-agnostic and it's faster.

## Android build check — `.github/workflows/android.yml`

Runs on **pull requests that touch `src-tauri/**`** (path-filtered — doc/frontend-only PRs
skip it): a **debug build for aarch64 only** on ubuntu-latest, so Android cross-compile
breakage is caught on the PR instead of at release time. This is the CI enforcement of
`REQ-MOBILE-1`'s build gate. Toolchain setup (Node 22, Rust Android targets, JDK 17, a
**pinned NDK**) is shared with the release job via the composite action
[`.github/actions/setup-android-build`](../.github/actions/setup-android-build/action.yml) —
bump the NDK there, in one place.

**Advisory, deliberately NOT a required check:** GitHub waits forever on a required check
whose path filter never fired, which would hang every PR that doesn't touch `src-tauri`. A
red ✗ still shows on the PR; treat it as merge-blocking by convention.

## Release — `.github/workflows/release.yml`

Triggered by pushing a **version tag** `v*`. Two jobs on the same tag: the **Windows**
installer (unsigned, via `tauri-apps/tauri-action`, which also creates the GitHub Release)
and — once it exists — the **Android** job attaches a **signed universal APK + AAB**
(`szmde-vX.Y.Z-android.apk/.aab`, all four ABIs) to that Release. To cut a release:

```sh
# bump the version everywhere it matters first (or just tag — the workflow syncs the
# bundle version FROM the tag, but package.json / Cargo.toml stay as-is):
git tag v0.1.0
git push origin v0.1.0
```

Both jobs rewrite `src-tauri/tauri.conf.json`'s `version` from the tag (minus the `v`), which
also drives the Android `versionName`/`versionCode` (Tauri regenerates
`gen/android/app/tauri.properties` from it at build time). The Android job is hand-rolled
(`npx tauri android build --apk --aab`) rather than `tauri-action`, whose mobile support is
experimental (m6-plan risk #9).

**Dry-run without a tag:** `workflow_dispatch` on the Release workflow runs the Android job
alone and uploads the APK/AAB as workflow artifacts (no Release is created). Use it to
exercise the Android pipeline safely.

### Android signing — the upload keystore (one-time setup, maintainer-held)

The keystore and its password are **never** in git or handled by tooling — the maintainer
generates and holds them. The Gradle side
(`gen/android/app/build.gradle.kts`) loads `gen/android/keystore.properties` (git-ignored)
**only if it exists**: absent → unsigned build (local debug workflows unaffected), present →
signed release. In CI the workflow writes that file from three repo secrets. Setup:

```sh
# 1. Generate the upload keystore ONCE and keep it somewhere safe + backed up.
#    You will be prompted to choose the store password (also used for the key).
#    NOTE: this cert's SHA-256 also goes into S6's assetlinks.json (App Links) and the
#    Android OAuth client — losing it means new-cert churn everywhere, so back it up.
keytool -genkey -v -keystore "$env:USERPROFILE\szmde-upload.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias szmde-upload
```

```sh
# 2. Add the three repo secrets (run from the repo; gh prompts nothing — values inline).
gh secret set ANDROID_KEY_ALIAS --body "szmde-upload"
gh secret set ANDROID_KEY_PASSWORD --body "<the password you chose>"
# base64 the keystore; PowerShell:
#   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\szmde-upload.jks")) | gh secret set ANDROID_KEY_BASE64
# or bash:  base64 -w0 ~/szmde-upload.jks | gh secret set ANDROID_KEY_BASE64
```

If the secrets are absent the release job **warns and builds unsigned** instead of failing,
so dry-runs work before the keystore exists — but a real release should be signed.

**Local signed builds** (optional): create `src-tauri/gen/android/keystore.properties` with
`keyAlias=szmde-upload`, `password=<pw>`, `storeFile=<absolute path to szmde-upload.jks>` — the
file is already git-ignored (`gen/android/.gitignore`). (`keystore.properties` itself keeps that
exact name — `build.gradle.kts` reads it by convention — as do the `ANDROID_KEY_*` secret names.)

**Unsigned Windows installers.** No Windows code-signing cert is configured, so SmartScreen
shows a one-time "unknown publisher" warning on first run (*More info → Run anyway*). Windows
signing can be added later by supplying a cert + repo secrets and wiring them into the action.

**Not yet built:** macOS / Linux installers, auto-update, Windows signing, Play Store
publishing (**REQ-PLAY-1**, its own milestone — M6 ships the sideload APK, m6-plan decision #4).
Add a runner to the release matrix when those are wanted.

## Branch & PR workflow

Once CI is in place we **stop committing directly to `main`**:

1. Branch off `main`: `git checkout -b feat/thing` (or `fix/…`, `ci/…`, `docs/…`).
2. Push the branch and open a PR. CI runs on the PR.
3. Merge only when CI is green.

**Branch protection** (enforces the above) is a GitHub repo setting — enable it under
*Settings → Branches → Add rule* for `main`: require both status checks to pass. **Match them by the job's `name:`, not its YAML id** — GitHub
lists them as `Frontend gate (typecheck · build · tests · coverage · traceability)` and
`Rust (fmt · clippy · test)`, which is what `gh pr checks` prints too. Require them
before merging, and require a PR. (A maintainer sets this; it's a repo-access setting, not part of
the workflow files.)
