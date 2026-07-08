import { StorageError } from "./provider";
import {
  isExpired,
  loadTokens,
  saveTokens,
  clearTokens,
  type SecureStore,
  type TokenSet,
} from "./secure-store";

/**
 * OAuth 2.0 Authorization Code + PKCE flow + token refresh (M3 S6, SPEC §6),
 * provider-agnostic. Desktop apps use PKCE with a loopback redirect and NO client
 * secret. The pure pieces (PKCE derivation, auth-URL build, code/refresh exchange)
 * are unit-tested here over an injected HTTP poster; the browser-open + loopback
 * **redirect capture** is the Tauri-shell integration tail (lands with S7).
 */
export interface OAuthConfig {
  clientId: string;
  /** Google "Desktop app" clients require a (non-confidential) client_secret in
   *  the token exchange; pure PKCE clients (e.g. some providers) omit it. */
  clientSecret?: string;
  authEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes: string[];
  /** Provider-specific auth-URL params, e.g. Google's access_type=offline. */
  extraAuthParams?: Record<string, string>;
}

export interface PostResult {
  ok: boolean;
  status: number;
  body: unknown;
}
/** Injected HTTP POST (x-www-form-urlencoded). The real impl is Tauri http /
 *  fetch; tests pass a fake that inspects the form and returns canned bodies. */
export type TokenPoster = (url: string, form: Record<string, string>) => Promise<PostResult>;

// --- PKCE ------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function defaultRandomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

/** A PKCE `code_verifier`: base64url of 32 random bytes (43 chars). */
export function generateVerifier(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  return base64url(randomBytes(32));
}

/** The S256 `code_challenge` for a verifier: base64url(SHA-256(verifier)). */
export async function deriveChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// --- Authorization URL -----------------------------------------------------

export function buildAuthUrl(cfg: OAuthConfig, challenge: string, state: string): string {
  const u = new URL(cfg.authEndpoint);
  const p = u.searchParams;
  p.set("client_id", cfg.clientId);
  p.set("redirect_uri", cfg.redirectUri);
  p.set("response_type", "code");
  p.set("scope", cfg.scopes.join(" "));
  p.set("code_challenge", challenge);
  p.set("code_challenge_method", "S256");
  p.set("state", state);
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) p.set(k, v);
  return u.toString();
}

// --- Token exchange / refresh ----------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function tokenSetFrom(r: PostResult, now: number): TokenSet {
  if (!r.ok) throw new StorageError("auth", `token endpoint returned ${r.status}`);
  const b = r.body as Partial<TokenResponse>;
  if (typeof b.access_token !== "string" || typeof b.expires_in !== "number") {
    throw new StorageError("auth", "malformed token response");
  }
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null,
    expiresAt: now + b.expires_in * 1000,
  };
}

/** Exchange an authorization `code` (with its PKCE verifier) for tokens. */
export async function exchangeCode(
  cfg: OAuthConfig,
  verifier: string,
  code: string,
  post: TokenPoster,
  now: number,
): Promise<TokenSet> {
  const form: Record<string, string> = {
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
  };
  if (cfg.clientSecret) form.client_secret = cfg.clientSecret;
  return tokenSetFrom(await post(cfg.tokenEndpoint, form), now);
}

/** Refresh an access token. The response often omits a new refresh token, so we
 *  carry the prior one forward. */
export async function refreshTokens(
  cfg: OAuthConfig,
  refreshToken: string,
  post: TokenPoster,
  now: number,
): Promise<TokenSet> {
  const form: Record<string, string> = {
    client_id: cfg.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  };
  if (cfg.clientSecret) form.client_secret = cfg.clientSecret;
  const t = tokenSetFrom(await post(cfg.tokenEndpoint, form), now);
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

// --- Client ----------------------------------------------------------------

/**
 * Stateful OAuth client for one account: drives the PKCE handshake, persists
 * tokens in a SecureStore, and hands out a valid access token (refreshing when
 * expired). `now`/`random` are injectable for deterministic tests.
 */
export class OAuthClient {
  #cfg: OAuthConfig;
  #store: SecureStore;
  #accountKey: string;
  #post: TokenPoster;
  #now: () => number;
  #random: (n: number) => Uint8Array;
  #refreshing: Promise<TokenSet> | null = null;

  constructor(
    cfg: OAuthConfig,
    store: SecureStore,
    accountKey: string,
    post: TokenPoster,
    opts: { now?: () => number; random?: (n: number) => Uint8Array } = {},
  ) {
    this.#cfg = cfg;
    this.#store = store;
    this.#accountKey = accountKey;
    this.#post = post;
    this.#now = opts.now ?? (() => Date.now());
    this.#random = opts.random ?? defaultRandomBytes;
  }

  /** Start the handshake: returns the URL to open plus the `verifier`/`state` the
   *  caller must keep to complete it (and to validate the redirect's state). */
  async beginAuth(): Promise<{ url: string; verifier: string; state: string }> {
    const verifier = generateVerifier(this.#random);
    const challenge = await deriveChallenge(verifier);
    const state = base64url(this.#random(16));
    return { url: buildAuthUrl(this.#cfg, challenge, state), verifier, state };
  }

  /** Finish the handshake with the captured `code` + its `verifier`. */
  async completeAuth(code: string, verifier: string): Promise<void> {
    const tokens = await exchangeCode(this.#cfg, verifier, code, this.#post, this.#now());
    await saveTokens(this.#store, this.#accountKey, tokens);
  }

  /**
   * A valid access token, refreshing (and repersisting) if expired. Throws
   * StorageError("auth") when there are no tokens, or the session can't refresh —
   * the caller re-runs beginAuth/completeAuth.
   */
  async getAccessToken(): Promise<string> {
    const tokens = await loadTokens(this.#store, this.#accountKey);
    if (!tokens) throw new StorageError("auth", "not connected");
    if (!isExpired(tokens, this.#now())) return tokens.accessToken;
    if (!tokens.refreshToken) throw new StorageError("auth", "session expired, reconnect");
    // Collapse concurrent refreshes (autosave + a manual save share this client)
    // into one network call + one token write — critical when the Google project
    // has refresh-token rotation on, where a duplicate refresh would invalid_grant.
    if (!this.#refreshing) {
      const rt = tokens.refreshToken;
      this.#refreshing = refreshTokens(this.#cfg, rt, this.#post, this.#now())
        .then(async (refreshed) => {
          await saveTokens(this.#store, this.#accountKey, refreshed);
          return refreshed;
        })
        .finally(() => {
          this.#refreshing = null;
        });
    }
    return (await this.#refreshing).accessToken;
  }

  async disconnect(): Promise<void> {
    await clearTokens(this.#store, this.#accountKey);
  }
}
