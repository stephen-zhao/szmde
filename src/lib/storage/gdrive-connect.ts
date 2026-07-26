import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrent as getCurrentDeepLink, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { isAndroid } from "../platform";
import { GoogleDriveProvider } from "./gdrive";
import { OAuthClient, type OAuthConfig, type TokenPoster } from "./oauth";
import { clearTokens, loadTokens, type SecureStore } from "./secure-store";
import { StorageError } from "./provider";
import type { AuthedFetch } from "./cloud-http";
import { bearerFetch, httpTokenPoster } from "./tauri-transport";
import { TauriSecureStore } from "./tauri-secure-store";

/**
 * Google Drive connect/use orchestration (M3 L2). Wires the tested seams to the
 * live transport: PKCE + token exchange/refresh via OAuthClient over the
 * plugin-http TokenPoster; the browser sign-in via the Rust loopback commands;
 * tokens in the OS keyring (TauriSecureStore); Drive REST via GoogleDriveProvider
 * over a bearer-attaching plugin-http fetch. Every I/O dependency is injectable so
 * the orchestration is unit-testable; the live round-trip is verified by WF-17.
 */
export const GDRIVE_ACCOUNT = "gdrive:default";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
// Least-privilege per-file scope (REQ-CLOUD-3). `drive.file` covers files this app
// created PLUS any file the user grants via the Google Picker — pre-existing `.md`s
// are opened through `pickGoogleDriveFiles` (the system-browser desktop Picker,
// `trigger_onepick`), which grants per-file access as part of consent. Unlike the
// full `drive` scope this is NON-restricted: no Google restricted-scope verification,
// no unverified-app warning. (The full-scope era ended 2026-07; files opened under it
// need one re-pick to re-grant access under the narrow scope.)
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

// Extra auth params that turn the OAuth consent into a Google Picker session (the
// desktop/mobile Picker, REQ-CLOUD-3): the user picks a file in the system browser and
// the redirect comes back with `picked_file_ids`. Google permits ONLY `drive.file` on
// this flow (enforcing least privilege). This is the exact S1-verified minimal set —
// NO `allow_multiple` (szmde opens ONE document; multi-select would grant files the UI
// can't reach and would bloat the redirect), and NO `mimetypes` filter (Drive reports
// `.md` inconsistently as text/markdown vs application/octet-stream, which could hide
// the very files the user wants).
const PICKER_PARAMS = { trigger_onepick: "true" };

// Android's OAuth redirect (M6 S6b): an https App Link that Android verifies (via a
// hosted assetlinks.json) and routes back into the app, replacing the desktop
// 127.0.0.1 loopback (invalid on mobile). It MUST equal the Android OAuth client's
// registered redirect, and the same value is echoed in the token exchange.
const ANDROID_REDIRECT_URI = "https://www.zhaostephen.com/szmde/oauth2redirect";
// Deadline for the user to complete sign-in in the Custom Tab; matches the desktop
// oauth_loopback_await deadline. A closed tab / abandoned sign-in resolves as a timeout.
const AUTH_DEADLINE_MS = 180_000;

interface GdriveClientConfig {
  client_id: string;
  client_secret: string;
}
type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface GdriveDeps {
  invoke?: InvokeFn;
  store?: SecureStore;
  poster?: TokenPoster;
  authedFetchFactory?: (getToken: () => Promise<string>) => AuthedFetch;
  now?: () => number;
  random?: (n: number) => Uint8Array;
  // Android sign-in (S6b): the deep-link redirect capture + Custom Tab launch, all
  // injectable so the mobile flow is unit-testable with no device.
  isAndroid?: () => boolean;
  openUrl?: (url: string) => Promise<void>;
  onOpenUrl?: (handler: (urls: string[]) => void) => Promise<() => void>;
  getCurrentDeepLink?: () => Promise<string[] | null>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

function resolved(deps: GdriveDeps) {
  return {
    invoke: deps.invoke ?? (tauriInvoke as InvokeFn),
    store: deps.store ?? new TauriSecureStore(),
    poster: deps.poster ?? httpTokenPoster(),
    authedFetchFactory: deps.authedFetchFactory ?? ((g: () => Promise<string>) => bearerFetch(g, tauriFetch)),
    now: deps.now,
    random: deps.random,
    isAndroid: deps.isAndroid ?? isAndroid,
    openUrl: deps.openUrl ?? ((url: string) => openUrl(url)),
    onOpenUrl: deps.onOpenUrl ?? onOpenUrl,
    getCurrentDeepLink: deps.getCurrentDeepLink ?? getCurrentDeepLink,
    setTimer: deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)),
    clearTimer: deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)),
  };
}

/** OAuthConfig for the exchange/refresh. `redirectUri` is the loopback URL during
 *  connect; refresh doesn't use it, so callers that only refresh pass "". `extra`
 *  adds flow-specific auth params (the Picker's PICKER_PARAMS). */
function oauthConfig(
  cfg: GdriveClientConfig,
  redirectUri: string,
  extra: Record<string, string> = {},
): OAuthConfig {
  return {
    clientId: cfg.client_id,
    clientSecret: cfg.client_secret,
    authEndpoint: AUTH_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    redirectUri,
    scopes: DRIVE_SCOPES,
    extraAuthParams: { access_type: "offline", prompt: "consent", ...extra },
  };
}

async function readConfig(invoke: InvokeFn): Promise<GdriveClientConfig | null> {
  return invoke<GdriveClientConfig | null>("read_gdrive_config");
}

type ResolvedDeps = ReturnType<typeof resolved>;

/** Extract the OAuth params from a deep-link redirect URL (the App Link Google sends
 *  back). Exported + pure so it is fully unit-testable. */
export function parseDeepLinkRedirect(url: string): { code?: string; state?: string; error?: string } {
  const q = new URL(url).searchParams;
  return {
    code: q.get("code") ?? undefined,
    state: q.get("state") ?? undefined,
    error: q.get("error") ?? undefined,
  };
}

/** The first deep-link URL whose `state` matches ours. The App Link intent-filter is
 *  public — any app can fire the redirect URL at us — so a foreign/forged `state` (or an
 *  unparseable URL) is ignored, never aborting a real in-flight sign-in. */
function pickForState(urls: string[] | null, expected: string): string | null {
  for (const u of urls ?? []) {
    try {
      if (parseDeepLinkRedirect(u).state === expected) return u;
    } catch {
      /* not a parseable URL — ignore */
    }
  }
  return null;
}

/** Launch the auth URL in a Custom Tab and resolve with the state-matched redirect URL
 *  Android routes back via the deep-link plugin. Drains `getCurrent()` first (cold start
 *  / already-delivered), else listens; a closed tab resolves as a deadline timeout. */
async function awaitRedirect(
  d: ResolvedDeps,
  expectedState: string,
  launch: () => Promise<void>,
): Promise<string> {
  const early = pickForState(await d.getCurrentDeepLink(), expectedState);
  if (early) return early;
  return new Promise<string>((resolve, reject) => {
    let done = false;
    let timer: unknown;
    let unlisten: (() => void) | null = null;
    const finish = (act: () => void) => {
      if (done) return;
      done = true;
      if (timer !== undefined) d.clearTimer(timer);
      unlisten?.();
      act();
    };
    d.onOpenUrl((urls) => {
      const hit = pickForState(urls, expectedState);
      if (hit) finish(() => resolve(hit));
    })
      .then((un) => {
        unlisten = un;
        // Arm the deadline only AFTER the listener is attached, so there is no window in
        // which the timeout could fire before a redirect could be captured, and launch
        // the Custom Tab.
        timer = d.setTimer(() => finish(() => reject(new StorageError("auth", "sign-in timed out"))), AUTH_DEADLINE_MS);
        return launch();
      })
      .catch((e) => finish(() => reject(e)));
  });
}

/** Android sign-in: an https App Link redirect captured by the deep-link plugin,
 *  replacing the desktop 127.0.0.1 loopback. One client with the App Link redirectUri so
 *  the authorize URL AND the token exchange echo the identical URI (Google requires the
 *  match). `state` (128-bit) is validated in `awaitRedirect` (CSRF gate). */
async function connectAndroid(cfg: GdriveClientConfig, d: ResolvedDeps): Promise<void> {
  const client = new OAuthClient(
    oauthConfig(cfg, ANDROID_REDIRECT_URI),
    d.store,
    GDRIVE_ACCOUNT,
    d.poster,
    { now: d.now, random: d.random },
  );
  const { url, verifier, state } = await client.beginAuth();
  const redirectUrl = await awaitRedirect(d, state, () => d.openUrl(url));
  const { code, error } = parseDeepLinkRedirect(redirectUrl);
  if (error) throw new StorageError("auth", `sign-in was declined: ${error}`);
  if (!code) throw new StorageError("auth", "no authorization code in the sign-in redirect");
  await client.completeAuth(code, verifier);
}

/** Run the OAuth handshake and persist the tokens in the OS keyring. Desktop uses the
 *  Rust 127.0.0.1 loopback; Android uses the deep-link App Link redirect (S6b). Throws
 *  auth if Drive isn't configured. */
export async function connectGoogleDrive(deps: GdriveDeps = {}): Promise<void> {
  const d = resolved(deps);
  const cfg = await readConfig(d.invoke);
  if (!cfg) {
    throw new StorageError(
      "auth",
      "Google Drive isn't configured — add gdrive_client.json (see docs/m3-cloud-setup.md).",
    );
  }
  if (d.isAndroid()) return connectAndroid(cfg, d);
  const port = await d.invoke<number>("oauth_loopback_reserve");
  const client = new OAuthClient(
    oauthConfig(cfg, `http://127.0.0.1:${port}`),
    d.store,
    GDRIVE_ACCOUNT,
    d.poster,
    { now: d.now, random: d.random },
  );
  const { url, verifier, state } = await client.beginAuth();
  const code = await d.invoke<string>("oauth_loopback_await", { authUrl: url, expectedState: state });
  await client.completeAuth(code, verifier);
}

/**
 * Open the Google Picker in the system browser (REQ-CLOUD-3) and return the ids of
 * the files the user picked. This is the desktop/mobile Picker: one browser tab where
 * the user consents to `drive.file` AND picks files; the loopback redirect carries
 * `picked_file_ids` + the auth `code`. The code exchange persists fresh tokens, so a
 * pick DOUBLES AS sign-in — no separate connect is needed first, and the per-file
 * grant makes the picked files readable/writable under the narrow scope. Returns []
 * when consent completed but nothing was picked. Throws auth if Drive isn't
 * configured; a cancelled consent surfaces as the Rust command's error.
 */
export async function pickGoogleDriveFiles(deps: GdriveDeps = {}): Promise<string[]> {
  const d = resolved(deps);
  const cfg = await readConfig(d.invoke);
  if (!cfg) {
    throw new StorageError(
      "auth",
      "Google Drive isn't configured — add gdrive_client.json (see docs/m3-cloud-setup.md).",
    );
  }
  const port = await d.invoke<number>("oauth_loopback_reserve");
  const client = new OAuthClient(
    oauthConfig(cfg, `http://127.0.0.1:${port}`, PICKER_PARAMS),
    d.store,
    GDRIVE_ACCOUNT,
    d.poster,
    { now: d.now, random: d.random },
  );
  const { url, verifier, state } = await client.beginAuth();
  const r = await d.invoke<{ code: string; pickedFileIds: string | null }>("oauth_pick_await", {
    authUrl: url,
    expectedState: state,
  });
  await client.completeAuth(r.code, verifier); // the pick's code → tokens in the keyring
  return r.pickedFileIds ? r.pickedFileIds.split(",").filter(Boolean) : [];
}

export async function disconnectGoogleDrive(deps: GdriveDeps = {}): Promise<void> {
  const d = resolved(deps);
  await clearTokens(d.store, GDRIVE_ACCOUNT);
}

/** True if Drive tokens are stored (the account was connected before). */
export async function isGoogleDriveConnected(deps: GdriveDeps = {}): Promise<boolean> {
  const d = resolved(deps);
  return (await loadTokens(d.store, GDRIVE_ACCOUNT)) !== null;
}

/** A GoogleDriveProvider that refreshes via the stored tokens, or null if Drive
 *  isn't configured. */
export async function makeGoogleDriveProvider(deps: GdriveDeps = {}): Promise<GoogleDriveProvider | null> {
  const d = resolved(deps);
  const cfg = await readConfig(d.invoke);
  if (!cfg) return null;
  const client = new OAuthClient(oauthConfig(cfg, ""), d.store, GDRIVE_ACCOUNT, d.poster, { now: d.now });
  return new GoogleDriveProvider(d.authedFetchFactory(() => client.getAccessToken()));
}
