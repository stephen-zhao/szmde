import { describe, expect, it, vi } from "vitest";
import {
  OAuthClient,
  buildAuthUrl,
  deriveChallenge,
  exchangeCode,
  generateVerifier,
  refreshTokens,
  type OAuthConfig,
  type PostResult,
  type TokenPoster,
} from "./oauth";
import { InMemorySecureStore, loadTokens } from "./secure-store";

const CFG: OAuthConfig = {
  clientId: "client-123",
  authEndpoint: "https://auth.example.com/authorize",
  tokenEndpoint: "https://auth.example.com/token",
  redirectUri: "http://127.0.0.1:5173/callback",
  scopes: ["files.read", "files.write"],
  extraAuthParams: { access_type: "offline" },
};

const ok = (body: unknown): PostResult => ({ ok: true, status: 200, body });
const fixedRandom = (fill: number) => (n: number) => new Uint8Array(n).fill(fill);

describe("PKCE", () => {
  it("derives the RFC 7636 reference challenge for the reference verifier", async () => {
    // RFC 7636 Appendix B test vector — proves the S256 + base64url pipeline.
    const challenge = await deriveChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generateVerifier produces 43 url-safe base64 chars with no padding", () => {
    const v = generateVerifier(fixedRandom(0)); // 32 zero bytes
    expect(v).toHaveLength(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("base64url maps '/' to '_' (0xff bytes)", () => {
    expect(generateVerifier(() => new Uint8Array([0xff, 0xff, 0xff]))).toBe("____");
  });
});

describe("buildAuthUrl", () => {
  it("includes the PKCE + standard params and provider extras", () => {
    const url = new URL(buildAuthUrl(CFG, "CHAL", "STATE"));
    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("client-123");
    expect(p.get("redirect_uri")).toBe("http://127.0.0.1:5173/callback");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("files.read files.write");
    expect(p.get("code_challenge")).toBe("CHAL");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toBe("STATE");
    expect(p.get("access_type")).toBe("offline"); // extra param
  });

  it("works without extraAuthParams", () => {
    const url = new URL(buildAuthUrl({ ...CFG, extraAuthParams: undefined }, "C", "S"));
    expect(url.searchParams.get("access_type")).toBeNull();
  });
});

describe("token exchange / refresh", () => {
  it("exchangeCode posts the code+verifier and builds a TokenSet", async () => {
    const post: TokenPoster = vi.fn(async () =>
      ok({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }),
    );
    const t = await exchangeCode(CFG, "VER", "CODE", post, 1000);
    expect(t).toEqual({ accessToken: "AT", refreshToken: "RT", expiresAt: 1000 + 3600_000 });
    expect(post).toHaveBeenCalledWith("https://auth.example.com/token", {
      client_id: "client-123",
      redirect_uri: "http://127.0.0.1:5173/callback",
      grant_type: "authorization_code",
      code: "CODE",
      code_verifier: "VER",
    });
  });

  it("throws StorageError('auth') on a non-OK token response", async () => {
    const post: TokenPoster = async () => ({ ok: false, status: 400, body: { error: "bad" } });
    await expect(exchangeCode(CFG, "V", "C", post, 0)).rejects.toMatchObject({ kind: "auth" });
  });

  it("throws StorageError('auth') on a malformed token body", async () => {
    const post: TokenPoster = async () => ok({ refresh_token: "RT" }); // no access_token/expires_in
    await expect(exchangeCode(CFG, "V", "C", post, 0)).rejects.toMatchObject({ kind: "auth" });
  });

  it("refreshTokens keeps the prior refresh token when the response omits one", async () => {
    const post: TokenPoster = async () => ok({ access_token: "AT2", expires_in: 1000 });
    const t = await refreshTokens(CFG, "OLD_RT", post, 5000);
    expect(t).toEqual({ accessToken: "AT2", refreshToken: "OLD_RT", expiresAt: 5000 + 1000_000 });
  });

  it("refreshTokens adopts a rotated refresh token when present", async () => {
    const post: TokenPoster = async () => ok({ access_token: "AT2", refresh_token: "NEW_RT", expires_in: 1 });
    const t = await refreshTokens(CFG, "OLD_RT", post, 0);
    expect(t.refreshToken).toBe("NEW_RT");
  });

  it("includes client_secret in the exchange when the config has one (Google desktop)", async () => {
    let sentForm: Record<string, string> = {};
    const post: TokenPoster = async (_url, form) => {
      sentForm = form;
      return ok({ access_token: "AT", expires_in: 1 });
    };
    await exchangeCode({ ...CFG, clientSecret: "SECRET" }, "V", "C", post, 0);
    expect(sentForm.client_secret).toBe("SECRET");
  });

  it("omits client_secret when the config has none", async () => {
    let sentForm: Record<string, string> = {};
    const post: TokenPoster = async (_url, form) => {
      sentForm = form;
      return ok({ access_token: "AT", expires_in: 1 });
    };
    await exchangeCode(CFG, "V", "C", post, 0); // CFG has no clientSecret
    expect(sentForm.client_secret).toBeUndefined();
  });

  it("includes client_secret on refresh too", async () => {
    let sentForm: Record<string, string> = {};
    const post: TokenPoster = async (_url, form) => {
      sentForm = form;
      return ok({ access_token: "AT2", expires_in: 1 });
    };
    await refreshTokens({ ...CFG, clientSecret: "SECRET" }, "RT", post, 0);
    expect(sentForm.client_secret).toBe("SECRET");
  });
});

describe("OAuthClient", () => {
  it("beginAuth returns a URL whose challenge matches the verifier", async () => {
    const store = new InMemorySecureStore();
    const c = new OAuthClient(CFG, store, "acct", vi.fn(), { random: fixedRandom(1) });
    const { url, verifier, state } = await c.beginAuth();
    expect(verifier).toBe(generateVerifier(fixedRandom(1)));
    expect(state).toBeTruthy();
    expect(new URL(url).searchParams.get("code_challenge")).toBe(await deriveChallenge(verifier));
  });

  it("completeAuth exchanges the code and persists the tokens", async () => {
    const store = new InMemorySecureStore();
    const post: TokenPoster = async () => ok({ access_token: "AT", refresh_token: "RT", expires_in: 3600 });
    const c = new OAuthClient(CFG, store, "acct", post, { now: () => 1000 });
    await c.completeAuth("CODE", "VER");
    expect(await loadTokens(store, "acct")).toEqual({
      accessToken: "AT",
      refreshToken: "RT",
      expiresAt: 1000 + 3600_000,
    });
  });

  it("getAccessToken throws auth when not connected", async () => {
    const c = new OAuthClient(CFG, new InMemorySecureStore(), "acct", vi.fn(), { now: () => 0 });
    await expect(c.getAccessToken()).rejects.toMatchObject({ kind: "auth" });
  });

  it("getAccessToken returns the stored token while it's still valid (no refresh)", async () => {
    const store = new InMemorySecureStore();
    const post = vi.fn();
    const c = new OAuthClient(CFG, store, "acct", post as unknown as TokenPoster, { now: () => 0 });
    await store.set("acct", JSON.stringify({ accessToken: "AT", refreshToken: "RT", expiresAt: 10_000_000 }));
    expect(await c.getAccessToken()).toBe("AT");
    expect(post).not.toHaveBeenCalled();
  });

  it("getAccessToken refreshes + repersists when the token is expired", async () => {
    const store = new InMemorySecureStore();
    const post: TokenPoster = async () => ok({ access_token: "AT2", expires_in: 3600 });
    const c = new OAuthClient(CFG, store, "acct", post, { now: () => 1_000_000 });
    await store.set("acct", JSON.stringify({ accessToken: "OLD", refreshToken: "RT", expiresAt: 0 }));
    expect(await c.getAccessToken()).toBe("AT2");
    expect((await loadTokens(store, "acct"))?.accessToken).toBe("AT2"); // repersisted
  });

  it("getAccessToken throws auth when expired and there is no refresh token", async () => {
    const store = new InMemorySecureStore();
    const c = new OAuthClient(CFG, store, "acct", vi.fn(), { now: () => 1_000_000 });
    await store.set("acct", JSON.stringify({ accessToken: "OLD", refreshToken: null, expiresAt: 0 }));
    await expect(c.getAccessToken()).rejects.toMatchObject({ kind: "auth" });
  });

  it("disconnect clears the stored tokens", async () => {
    const store = new InMemorySecureStore();
    await store.set("acct", JSON.stringify({ accessToken: "AT", refreshToken: "RT", expiresAt: 1 }));
    const c = new OAuthClient(CFG, store, "acct", vi.fn(), { now: () => 0 });
    await c.disconnect();
    expect(await loadTokens(store, "acct")).toBeNull();
  });

  it("uses real crypto + Date.now defaults when no opts are injected", async () => {
    // Covers the default `random`/`now` bindings: real getRandomValues + subtle.
    const store = new InMemorySecureStore();
    const post: TokenPoster = async () => ok({ access_token: "AT", refresh_token: "RT", expires_in: 60 });
    const c = new OAuthClient(CFG, store, "acct", post);
    const { url, verifier } = await c.beginAuth();
    expect(verifier).toHaveLength(43);
    expect(new URL(url).searchParams.get("code_challenge_method")).toBe("S256");
    await c.completeAuth("CODE", verifier);
    const saved = await loadTokens(store, "acct");
    expect(saved?.expiresAt).toBeGreaterThan(1_000_000_000_000); // ~Date.now()-based
  });
});
