# S1 runbook — resolve the Google Picker `redirect_uri` crux (REQ-CLOUD-3)

_This is the **S1 spike** from [gdrive-picker-plan.md](gdrive-picker-plan.md). It's a **you-run-it**
step — it needs your Google Cloud Console + a real OAuth consent, which the assistant can't perform.
Goal: answer **one** question so S2–S7 can proceed with the right redirect design._

> **✅ RESOLVED (2026-07-11): bare loopback works.** The spike redirected straight to
> `http://127.0.0.1:PORT` with `picked_file_ids` + `code` + matching `state` on the Desktop-app
> client — no HTTPS relay (S4 skipped). Kept for provenance / re-running if Google's behavior
> changes; the result is recorded in the plan doc._

## The question S1 answers

Google's desktop-Picker docs say the `redirect_uri` **"must be a public HTTPS URL … to use a localhost
URL … you must use a public HTTPS URL that then redirects to … localhost."** So:

> **Does `trigger_onepick=true` accept a bare `http://127.0.0.1:PORT` loopback redirect (like our normal
> OAuth flow does), or does it reject it and force a public-HTTPS relay?**

- **If bare loopback works** → we reuse the existing loopback verbatim and **skip S4** (the relay).
- **If it's rejected** → we build the tiny public-HTTPS relay (S4), carrying the port in `state`.

Also capture the exact redirect payload (`picked_file_ids`, `code`, `scope`, `error`) so S2's parser is
written against reality, not the docs.

## Part A — Cloud Console setup (~5 min)

You already have a Google Cloud project with an OAuth client (`gdrive_client.json` in
`%APPDATA%\com.zhaostephen.szmde\`). In [console.cloud.google.com](https://console.cloud.google.com),
with **that project selected**:

1. **Enable the Picker API** — *APIs & Services → Library →* search **"Google Picker API"** *→ Enable*.
2. **Check the OAuth client type** — *APIs & Services → Credentials → your OAuth client*. Note the
   **Application type**:
   - **Desktop app** → loopback redirects (`http://127.0.0.1:<any port>`) are allowed implicitly; no
     redirect registration needed. (This is what szmde uses today.)
   - **Web application** → you must add **`http://127.0.0.1:8723`** under *Authorized redirect URIs* and
     Save (localhost is exempt from the HTTPS-only rule, but the exact port must match).
   - Copy the **Client ID** — you'll pass it to the script below.
3. **Add the `drive.file` scope to the consent screen** — *APIs & Services → OAuth consent screen →
   Data access (Scopes) → Add scopes →* add **`.../auth/drive.file`** *→ Update / Save*. (`drive.file`
   is **non-sensitive**, so no restricted-scope assessment — this is the whole point.)
4. **Confirm you're a test user** — on the *OAuth consent screen*, under *Audience / Test users*, make
   sure your own Google account is listed (it already is, from the current Drive setup).

## Part B — Run the spike (no app code, no build)

Save this dependency-free Node script (Node 22, already in your WSL) as `gdrive-picker-s1.mjs` in a
scratch dir, then run it with your **Client ID**:

```js
// gdrive-picker-s1.mjs — does trigger_onepick redirect to a bare 127.0.0.1 loopback?
// Usage:  node gdrive-picker-s1.mjs <GOOGLE_CLIENT_ID> [port]
import http from "node:http";
import crypto from "node:crypto";

const CLIENT_ID = process.argv[2];
const PORT = Number(process.argv[3] || 8723);
if (!CLIENT_ID) { console.error("usage: node gdrive-picker-s1.mjs <GOOGLE_CLIENT_ID> [port]"); process.exit(1); }

const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = b64url(crypto.randomBytes(32));                                   // PKCE (unused here; we don't exchange)
const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
const state = b64url(crypto.randomBytes(16));
const redirectUri = `http://127.0.0.1:${PORT}/`;

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/drive.file",
  access_type: "offline",
  prompt: "consent",
  trigger_onepick: "true",
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
  // mimetypes: "text/markdown,text/plain",   // uncomment if you want to filter to .md-ish files
}).toString();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, redirectUri);
  console.log("\n=== REDIRECT RECEIVED (bare loopback WORKS) ===");
  console.log("full query      :", u.search);
  console.log("picked_file_ids :", u.searchParams.get("picked_file_ids"));
  console.log("code            :", u.searchParams.get("code") ? "(present)" : null);
  console.log("scope           :", u.searchParams.get("scope"));
  console.log("error           :", u.searchParams.get("error"));
  console.log("state matches   :", u.searchParams.get("state") === state);
  res.end("<h2>Done — close this tab and return to the terminal.</h2>");
  setTimeout(() => { server.close(); process.exit(0); }, 300);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Loopback catcher listening on ${redirectUri}\n`);
  console.log("1) Paste this URL into your browser, consent, and pick a .md file:\n");
  console.log("   " + authUrl + "\n");
  console.log("2) Watch here for the redirect — OR watch the browser for a Google error page.");
});
setTimeout(() => { console.error("\nTimed out after 5 min (no redirect hit the loopback)."); process.exit(2); }, 300000);
```

Run it (WSL):

```sh
node gdrive-picker-s1.mjs "YOUR_CLIENT_ID.apps.googleusercontent.com"
```

The Client ID is in `gdrive_client.json` (or the Console). It prints an auth URL — **paste it into your
browser** (pasting is more reliable than auto-open across WSL/Windows).

## Part C — Do the flow

In the browser: sign in → consent to `drive.file` → **the Google Picker should appear** → select a
pre-existing `.md` file → confirm. Then look at **both** the terminal and the browser.

## Part D — Read the result (the decision)

| What you observe | Meaning | Next |
|---|---|---|
| Terminal prints **`REDIRECT RECEIVED`** with a non-empty **`picked_file_ids`** and a `code` | ✅ **Bare loopback works.** `trigger_onepick` honors `http://127.0.0.1:PORT`. | **Skip S4** (no relay). Proceed to S2/S3. |
| Browser shows a Google error page (**`redirect_uri_mismatch`**, or `invalid_request` / *"redirect_uri must use HTTPS"* / *"must be a public HTTPS URL"*), terminal never fires | ❌ **Bare loopback rejected** for the picker flow. | Build **S4**: a public-HTTPS relay that 302s to the loopback (port in `state`). Capture the exact error text. |
| Picker never appears (consent completes but no file grid), or `error=…` on the redirect | `trigger_onepick`/params issue or cancel | Copy the exact URL/error; try dropping `mimetypes`, and re-confirm param spelling on the live [desktop-picker guide](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker). |
| `redirect_uri_mismatch` **and** your client is **Web application** | Redirect URI not registered | Add `http://127.0.0.1:8723` to *Authorized redirect URIs* (Part A.2) and re-run. |

### If bare loopback is rejected — the S4 relay shape (for reference)
Register a **public HTTPS** page (e.g. GitHub Pages or `zhaostephen.com/szmde-oauth`) as the
`redirect_uri`. It reads `picked_file_ids` + `code` + `state`, decodes the loopback port from `state`,
and client-side-redirects to `http://127.0.0.1:PORT/?picked_file_ids=…&code=…`. The loopback catcher is
unchanged. We'll build this in S4 only if S1 proves it's needed.

## Part E — Report back

Paste me **either**:
- ✅ the terminal's `REDIRECT RECEIVED` block (redact the `code`; I only need to see that
  `picked_file_ids` is populated and the shape of the query), **or**
- ❌ the exact Google **error** text (from the browser page or the redirect `error=` param) + your OAuth
  **client type** (Desktop vs Web).

That single result tells me whether to build S2/S3 straight onto the existing loopback or to add the S4
relay first — and pins S2's redirect parser to the real payload.
