# CI/CD & branch workflow

GitHub Actions: a **CI** gate on every change and a **Release** build on version tags.
Both live in [`.github/workflows/`](../.github/workflows/). See [INDEX.md](INDEX.md) for the
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

## Release — `.github/workflows/release.yml`

Triggered by pushing a **version tag** `v*`. Builds the **Windows** installer (unsigned) and
publishes it as a GitHub Release. To cut a release:

```sh
# bump the version everywhere it matters first (or just tag — the workflow syncs the
# bundle version FROM the tag, but package.json / Cargo.toml stay as-is):
git tag v0.1.0
git push origin v0.1.0
```

The workflow rewrites `src-tauri/tauri.conf.json`'s `version` to the tag (minus the `v`) so the
installer version matches the release, then runs `tauri-apps/tauri-action`, which builds and
creates the Release with the `.msi` + `.exe` assets attached.

**Unsigned installers.** No code-signing cert is configured, so Windows SmartScreen shows a
one-time "unknown publisher" warning on first run (*More info → Run anyway*). Signing can be
added later by supplying a cert + repo secrets and wiring them into the action.

**Not yet built:** macOS / Linux installers, auto-update, signing. The *release* pipeline is
Windows-only today; **Android is a live target** (M6 — `gen/android` committed, all four ABIs
cross-compile), but its APK is built locally rather than in CI — that is M6 S5 (`REQ-MOBILE-1`).
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
