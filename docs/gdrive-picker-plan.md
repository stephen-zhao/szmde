# Least-privilege Google Drive picker — design & plan (REQ-CLOUD-3)

_Status: **planned / next-up** (2026-07-11). Design grounded in a 6-agent cited research pass; the
one crux (the picker `redirect_uri`) is gated behind an **S1 Cloud-Console spike before any app code**.
See [roadmap.md](roadmap.md) for slotting and [SPEC.md §6](../SPEC.md) for the storage seam._

## Goal

Drop the **restricted full `https://www.googleapis.com/auth/drive` scope** — which forces Google's
restricted-scope verification (CASA / security assessment) and shows an "unverified app" warning on
the consent screen — for the **non-sensitive `https://www.googleapis.com/auth/drive.file` scope**, and
open a user's **pre-existing** `.md` files via a **Google Picker**.

Why this is the only real option (not a preference):

- `drive.file` is the **only** non-restricted Drive scope. `drive` and `drive.readonly` are both
  restricted. So `drive.file` is the sole path that avoids Google verification + the warning.
- But `drive.file` grants access **only** to files the app created **or that the user explicitly
  selects via the Google Picker**. Without a Picker, opening a pre-existing file 404s (the exact bug
  that made us take the broad scope in the first place). A custom in-app file browser can't substitute:
  under `drive.file`, `files.list` returns only app-created/already-granted files, so it can't
  enumerate the user's Drive either (**Approach C, rejected** below).

So: **least-privilege ⇒ `drive.file` ⇒ a Picker is mandatory.**

## The blocker we hit before (why the "obvious" Picker fails in Tauri)

The classic **web Picker** renders a Google-hosted `docs.google.com` iframe inside *your* page via the
`gapi` client library, and it enforces an origin at two points:

1. Its `postMessage` handshake requires `PickerBuilder.setOrigin()` to equal the host page's real
   `window.location.origin`; and
2. The OAuth/GIS token request validates that origin against the **Authorized JavaScript origins**
   registered on a **Web-application** OAuth client.

A bundled Tauri app's WebView origin is a **custom scheme** — `https://tauri.localhost` (Windows) or
`tauri://localhost` (macOS/Linux) — which is **not a registerable Google origin**, and
`setOrigin` rejects custom schemes. On top of that, the production CSP `script-src 'self'`
(`src-tauri/tauri.conf.json`) **blocks loading `https://apis.google.com/js/api.js`** in the WebView,
and Google **refuses OAuth inside embedded webviews** (`disallowed_useragent`, 403). So the web Picker
cannot run in the bundled WebView. That's what pushed us to the broad scope.

## The unlock: Google's system-browser desktop Picker (`trigger_onepick`)

Google shipped a **desktop/mobile Picker** flow (2024-25) that runs the Picker **entirely in the
system browser as an extension of the OAuth consent screen** — nothing loads in our WebView at all:

- Build the normal OAuth 2.0 auth-code URL at `https://accounts.google.com/o/oauth2/v2/auth` with
  `scope=…/drive.file` (the desktop flow permits **only** `drive.file`, no other scope),
  `response_type=code`, `access_type=offline`, **`prompt=consent`**, and **`trigger_onepick=true`**
  (optional: `allow_multiple=true`, `mimetypes=…`, `file_ids=…`, `allow_folder_selection=true`).
- Open it in the **system browser** (exactly what we already do for sign-in).
- The user consents **and picks files** in that one tab.
- Google redirects back to `redirect_uri` with **`picked_file_ids`** (comma-separated) + **`code`** +
  `scope` (or `error` if cancelled).
- We exchange `code`→tokens in **Rust/`oauth.ts`** and read the picked IDs via the existing
  `gdrive.ts` provider.

This **sidesteps every security issue**: no `apis.google.com` load, no CSP change, no authorized JS
origin, no developer key, no app id, and **no token in page JS** (the token is minted server-side from
the code exchange; only file IDs ride the redirect). It reuses szmde's proven
`oauth_loopback_reserve` / `oauth_loopback_await` / PKCE / keyring / plugin-http stack almost verbatim.

## Security issues → workarounds

| Issue (from the original blocker) | Workaround in this design |
|---|---|
| Custom-scheme WebView origin isn't a registerable Google JS origin; `setOrigin` rejects it | Render **no** Picker/GIS JS in the WebView. The desktop flow runs the Picker in the **system browser** — there is no JS/postMessage origin to register. |
| Prod CSP `script-src 'self'` blocks `apis.google.com/js/api.js` | **Leave the app CSP unchanged.** The desktop flow loads nothing from Google in the WebView. Do **not** add Google hosts to the app CSP. |
| Passing a live access token to a page (XSS / interception / leak) | The desktop flow **never exposes a token to any page**: `response_type=code` returns an auth code exchanged for tokens inside Rust (`exchangeCode`); only `picked_file_ids` are on the redirect. |
| Restricted-scope verification + "unverified app" warning | Flip `DRIVE_SCOPES` in [`gdrive-connect.ts`](../src/lib/storage/gdrive-connect.ts) to `drive.file` (non-sensitive → basic OAuth verification only). The desktop flow forbids combining `drive.file` with any other scope, which enforces least-privilege. |
| DNS-rebinding / loopback attack surface on the `127.0.0.1` listener | Harden `capture_one_redirect` ([`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)): bind **127.0.0.1 only** (never `0.0.0.0`), add **`Host`-header allowlist** validation (`127.0.0.1`/`localhost` + expected port → else 403), keep the one-shot high-entropy `state`/CSRF check + **PKCE S256**, close the socket the instant the redirect is consumed, and set **`SO_EXCLUSIVEADDRUSE`** on Windows (RFC 8252). |

## Approaches

**A — System-browser desktop Picker (`trigger_onepick`) over the existing loopback — RECOMMENDED.**
Least code, smallest attack surface, zero CSP/origin changes. The only genuinely new code is teaching
`parse_redirect` to also read `picked_file_ids`. Cons: the `redirect_uri` may need a public-HTTPS
relay (see crux); `prompt=consent` is required per pick; the flow is newer and sparsely documented,
with no public Tauri reference implementation yet.

**B — Local `127.0.0.1` server hosting the classic web Picker — FALLBACK.** Serve a Picker page from a
Rust HTTP server on a **fixed** `http://127.0.0.1:PORT` (a registerable JS origin — localhost is exempt
from the HTTPS-only rule, but the **exact port** must be pre-registered, no wildcards), opened in the
system browser or a Tauri child window. Needs a Web-app OAuth client + a developer key + app id
(project *number*), and puts the access token in browser JS (mitigate with exact-origin `postMessage`,
one-shot nonce, short TTL, close-on-complete). More moving parts and more token exposure. Use only if
A's redirect constraint proves fatal.

**C — Custom in-app Drive browser via `files.list` — REJECTED.** Under `drive.file`, `files.list`
returns only app-created/already-picked files, so it **cannot enumerate a user's pre-existing `.md`
files** and still 404s. Only useful *later* as a "recently opened / re-open granted files" view **after**
files are granted via a real Picker (A or B).

## Open risks — verify live (S1) before committing app code

1. **CRUX — redirect target.** The desktop-picker docs say `redirect_uri` **"must be a public HTTPS
   URL. If you want to use a … localhost URL …, you must use a public HTTPS URL that then redirects to
   … localhost."** So a bare `http://127.0.0.1:PORT` may **not** be registerable for this flow (unlike a
   normal RFC 8252 loopback). Plan for a tiny **public-HTTPS relay** (e.g. GitHub Pages or
   `zhaostephen.com`) that 302/JS-redirects to `http://127.0.0.1:PORT/?picked_file_ids=…`, carrying the
   ephemeral port in the OAuth `state` param. **Test end-to-end in Cloud Console first.**
2. **Client-type tension.** The guide says use a **Desktop-app** client (loopback, PKCE) yet also says
   the redirect must be public HTTPS (a Web-app property). Confirm which client type actually renders
   the picker and accepts which redirect. szmde currently uses a Desktop-app client with a secret.
3. **Maturity / param spelling.** The desktop flow isn't clearly labeled GA and `trigger_onepick` is
   sparsely documented — re-read the live guide and confirm exact param names before coding.
4. **Grant persistence.** Confirm a `drive.file` per-file grant + the stored refresh token lets us
   **re-open** a previously-picked file in later sessions **without** re-picking (so only first-open
   needs a pick).
5. **Refresh semantics.** `prompt=consent` per pick + `access_type=offline` — confirm a usable refresh
   token is issued and that repeated consents don't trip refresh-token rotation and break the
   single-client refresh logic in `oauth.ts` (`invalid_grant` risk).
6. **`.md` MIME filter.** Confirm `mimetypes=text/markdown,text/plain` actually surfaces `.md` (Drive
   may report `.md` as `application/octet-stream`).
7. **Migration UX.** Existing users must re-consent once when the scope narrows; files opened under the
   old full scope must be re-picked once to (re)grant per-file access. Design this one-time path.

## Staged build slices

- **S1 — Cloud-Console spike (no app code).** Enable the Picker API; create/confirm the OAuth client;
  empirically resolve the **crux**: does `drive.file` + `trigger_onepick` + `prompt=consent` accept a
  bare `http://127.0.0.1:PORT` redirect, and with which client type? Capture the exact redirect query
  (`picked_file_ids`, `code`, `scope`, `error`). **Gates S2–S4.** Step-by-step (a you-run-it spike with
  a ready-to-run Node script): **[gdrive-picker-s1-runbook.md](gdrive-picker-s1-runbook.md)**.
- **S2 — Rust redirect capture** (`src-tauri/src/lib.rs`). Extend `parse_redirect` to also return
  `picked_file_ids` (+ `error`); return `{code, picked_file_ids}` from `oauth_loopback_await` (or a new
  `oauth_pick_await`); add `Host`-header allowlist validation; keep the `state`/CSRF + PKCE checks. TDD
  via the existing pure-parser tests in the `lib.rs` tests module.
- **S3 — TS picker flow** (`oauth.ts` + `gdrive-connect.ts`). Add the `drive.file` scope constant and a
  picker auth-URL builder (`trigger_onepick`, `prompt=consent`, `access_type=offline`,
  `mimetypes=text/markdown,text/plain`); add a `pickAndOpen` orchestration (reserve loopback → await
  `code`+`picked_file_ids` → `exchangeCode` → persist tokens → return IDs). Unit-test the URL build +
  orchestration with injected `invoke`/`poster` to the 100%-lines gate.
- **S4 — (conditional on S1) HTTPS relay fallback.** Publish a static relay page that reads
  `code`+`picked_file_ids`+`state` and client-side-redirects to `http://127.0.0.1:PORT/?…` (port decoded
  from `state`); register it as the `redirect_uri`. **Skip entirely if S1 shows bare loopback works.**
- **S5 — UI wiring** (`HamburgerMenu.svelte` / `+page.svelte`). Repoint **Open from Google Drive…** to
  launch the picker instead of the paste-ID prompt; keep a local recent/known-files list so
  previously-granted files re-open without a re-pick; route **Save to Drive (new)** through
  `files.create` (`drive.file` can create app-owned files without a pick).
- **S6 — Scope migration + docs.** Flip `DRIVE_SCOPES` to `drive.file`; touch `capabilities/default.json`
  only if needed (`googleapis.com` is already allowed); rewrite the storage-seam notes in
  [CLAUDE.md](../CLAUDE.md) and [m3-cloud-setup.md](m3-cloud-setup.md); add the one-time re-consent path;
  confirm **no app CSP change** was made.
- **S7 — Live verification + review.** Add an LLM workflow (`WF-XX`,
  [llm-workflow-tests.md](llm-workflow-tests.md)) exercising pick → open a pre-existing `.md` → edit →
  save end-to-end, asserting the consent screen shows **no** unverified-app / restricted-scope warning.
  Run the adversarial ultracode review before merge.

## References (fetched 2026-07-11)

- Google Picker — desktop & mobile apps: <https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker> · overview: <https://developers.google.com/workspace/drive/picker/guides/overview-desktop>
- Google Picker — web apps (the path we avoid): <https://developers.google.com/workspace/drive/picker/guides/web-picker>
- Drive API-specific auth (scope sensitivity): <https://developers.google.com/workspace/drive/api/guides/api-specific-auth> · restricted-scope verification: <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
- OAuth for native apps + loopback: <https://developers.google.com/identity/protocols/oauth2/native-app> · loopback migration: <https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration> · RFC 8252: <https://www.rfc-editor.org/rfc/rfc8252.html>
- OAuth in embedded webviews blocked: <https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/>
- Tauri 2 CSP scope + remote-URL capabilities: <https://v2.tauri.app/security/csp/> · <https://v2.tauri.app/security/capabilities/> · discussion #11970: <https://github.com/tauri-apps/tauri/discussions/11970>
- Token best-practices (implicit-flow Picker; partly N/A to the code flow): <https://dev.to/googleworkspace/secure-google-drive-picker-token-best-practices-43al>
- Tauri loopback prior art: <https://github.com/FabianLars/tauri-plugin-oauth> · <https://github.com/Choochmeque/tauri-plugin-google-auth>
