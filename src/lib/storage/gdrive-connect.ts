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
// Full Drive read/write. Needed to OPEN pre-existing files by URL/id: the narrower
// `drive.file` scope only covers files THIS app created (or that were picked via the
// Google Picker), so opening a user's own existing `.md` returns 404. The Picker would
// preserve least-privilege but isn't reliable in a bundled Tauri app (its origin check
// rejects the custom-scheme WebView origin), so we take the broad scope. `drive` is a
// Google "restricted" scope — the consent screen shows an unverified-app warning until
// the app is verified; fine for personal use (add yourself as a test user).
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

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
 *  connect; refresh doesn't use it, so callers that only refresh pass "". */
function oauthConfig(cfg: GdriveClientConfig, redirectUri: string): OAuthConfig {
  return {
    clientId: cfg.client_id,
    clientSecret: cfg.client_secret,
    authEndpoint: AUTH_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    redirectUri,
    scopes: DRIVE_SCOPES,
    extraAuthParams: { access_type: "offline", prompt: "consent" },
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
