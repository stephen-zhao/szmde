/**
 * OAuth token storage (REQ-SEC-1, SPEC §6). Tokens live in the OS secure store
 * (Credential Manager / Keychain / Keystore), NEVER in user.json — validate.ts
 * already whitelists `storage.accounts[]` to non-secret fields. This module is the
 * platform-agnostic seam + token model; the desktop `SecureStore` impl over a Rust
 * keyring command is the integration tail (lands with the cloud wiring, S7).
 */

export interface SecureStore {
  /** The stored value for `key`, or null if absent. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Test double + fallback for environments without an OS keyring (headless CI, a
 * Linux box with no secret service). NOT durable — process-lifetime only.
 */
export class InMemorySecureStore implements SecureStore {
  #m = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.#m.has(key) ? (this.#m.get(key) as string) : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.#m.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.#m.delete(key);
  }
}

/** OAuth tokens for one connected account. */
export interface TokenSet {
  accessToken: string;
  /** A refresh response may omit a new refresh token; we keep the prior one.
   *  null only when we never received one. */
  refreshToken: string | null;
  /** Epoch ms at which the access token expires. */
  expiresAt: number;
}

export function serializeTokens(t: TokenSet): string {
  return JSON.stringify(t);
}

/**
 * Parse a stored token blob. Returns null on anything malformed — a corrupt
 * secure entry must degrade to "re-authenticate", never throw into the editor.
 */
export function parseTokens(raw: string): TokenSet | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.accessToken !== "string") return null;
  if (o.refreshToken !== null && typeof o.refreshToken !== "string") return null;
  if (typeof o.expiresAt !== "number") return null;
  return { accessToken: o.accessToken, refreshToken: o.refreshToken, expiresAt: o.expiresAt };
}

/**
 * True if the access token is expired, or within `skewMs` of expiry — refresh a
 * touch early so a request can't race the expiry boundary.
 */
export function isExpired(t: TokenSet, now: number, skewMs = 60_000): boolean {
  return now >= t.expiresAt - skewMs;
}

export async function loadTokens(store: SecureStore, accountKey: string): Promise<TokenSet | null> {
  const raw = await store.get(accountKey);
  return raw === null ? null : parseTokens(raw);
}

export async function saveTokens(
  store: SecureStore,
  accountKey: string,
  tokens: TokenSet,
): Promise<void> {
  await store.set(accountKey, serializeTokens(tokens));
}

export async function clearTokens(store: SecureStore, accountKey: string): Promise<void> {
  await store.delete(accountKey);
}
