import { describe, expect, it } from "vitest";
import {
  InMemorySecureStore,
  clearTokens,
  isExpired,
  loadTokens,
  parseTokens,
  saveTokens,
  serializeTokens,
  type TokenSet,
} from "./secure-store";

const tokens = (over: Partial<TokenSet> = {}): TokenSet => ({
  accessToken: "AT",
  refreshToken: "RT",
  expiresAt: 1_000_000,
  ...over,
});

describe("[REQ-SEC-1] InMemorySecureStore", () => {
  it("roundtrips get/set and returns null for an absent key", async () => {
    const s = new InMemorySecureStore();
    expect(await s.get("k")).toBeNull();
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
  });

  it("deletes a key (and tolerates deleting an absent one)", async () => {
    const s = new InMemorySecureStore();
    await s.set("k", "v");
    await s.delete("k");
    expect(await s.get("k")).toBeNull();
    await expect(s.delete("missing")).resolves.toBeUndefined();
  });
});

describe("[REQ-SEC-1] TokenSet serialize/parse", () => {
  it("roundtrips a token set", () => {
    const t = tokens();
    expect(parseTokens(serializeTokens(t))).toEqual(t);
  });

  it("accepts a null refreshToken", () => {
    const t = tokens({ refreshToken: null });
    expect(parseTokens(serializeTokens(t))).toEqual(t);
  });

  it("returns null for invalid JSON", () => {
    expect(parseTokens("{not json")).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(parseTokens("5")).toBeNull();
    expect(parseTokens("null")).toBeNull();
  });

  it("returns null when required fields are missing or mistyped", () => {
    expect(parseTokens(JSON.stringify({ refreshToken: "RT", expiresAt: 1 }))).toBeNull(); // no accessToken
    expect(parseTokens(JSON.stringify({ accessToken: "AT", refreshToken: 5, expiresAt: 1 }))).toBeNull();
    expect(parseTokens(JSON.stringify({ accessToken: "AT", refreshToken: "RT" }))).toBeNull(); // no expiresAt
  });
});

describe("[REQ-SEC-1] isExpired", () => {
  it("is false well before expiry", () => {
    expect(isExpired(tokens({ expiresAt: 1_000_000 }), 0)).toBe(false);
  });

  it("is true after expiry", () => {
    expect(isExpired(tokens({ expiresAt: 1_000 }), 2_000)).toBe(true);
  });

  it("refreshes early within the skew window", () => {
    const t = tokens({ expiresAt: 100_000 });
    expect(isExpired(t, 100_000 - 60_000)).toBe(true); // exactly at the default skew
    expect(isExpired(t, 100_000 - 60_001)).toBe(false); // just outside it
  });

  it("honors a custom skew", () => {
    const t = tokens({ expiresAt: 100_000 });
    expect(isExpired(t, 95_000, 10_000)).toBe(true); // within 10s skew
    expect(isExpired(t, 80_000, 10_000)).toBe(false);
  });
});

describe("[REQ-SEC-1] account-keyed token helpers", () => {
  it("saves, loads, and clears tokens for an account key", async () => {
    const store = new InMemorySecureStore();
    const key = "gdrive:stephen@example.com";
    expect(await loadTokens(store, key)).toBeNull(); // none yet

    const t = tokens();
    await saveTokens(store, key, t);
    expect(await loadTokens(store, key)).toEqual(t);

    await clearTokens(store, key);
    expect(await loadTokens(store, key)).toBeNull();
  });

  it("loadTokens returns null for a corrupt stored blob", async () => {
    const store = new InMemorySecureStore();
    await store.set("k", "garbage{");
    expect(await loadTokens(store, "k")).toBeNull();
  });
});
