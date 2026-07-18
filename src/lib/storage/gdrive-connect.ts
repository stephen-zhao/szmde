import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
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
}

function resolved(deps: GdriveDeps) {
  return {
    invoke: deps.invoke ?? (tauriInvoke as InvokeFn),
    store: deps.store ?? new TauriSecureStore(),
    poster: deps.poster ?? httpTokenPoster(),
    authedFetchFactory: deps.authedFetchFactory ?? ((g: () => Promise<string>) => bearerFetch(g, tauriFetch)),
    now: deps.now,
    random: deps.random,
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

/** Run the OAuth handshake (system-browser sign-in via the Rust loopback) and
 *  persist the tokens in the OS keyring. Throws auth if Drive isn't configured. */
export async function connectGoogleDrive(deps: GdriveDeps = {}): Promise<void> {
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
