import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri modules so the production default deps (resolved()) are callable
// for the default-coverage tests without a Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
import { invoke as mockedInvoke } from "@tauri-apps/api/core";
import {
  GDRIVE_ACCOUNT,
  connectGoogleDrive,
  disconnectGoogleDrive,
  isGoogleDriveConnected,
  makeGoogleDriveProvider,
} from "./gdrive-connect";
import { GoogleDriveProvider } from "./gdrive";
import { InMemorySecureStore, loadTokens } from "./secure-store";
import { StorageError, type Revision } from "./provider";
import type { TokenPoster } from "./oauth";

const CONFIG = { client_id: "cid.apps.googleusercontent.com", client_secret: "secret" };
const fixedRandom = (n: number) => new Uint8Array(n).fill(7);
const tokenOk: TokenPoster = async () => ({
  ok: true,
  status: 200,
  body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 },
});

/** An invoke double dispatching per command. */
function fakeInvoke(over: Partial<Record<string, (a: Record<string, unknown>) => unknown>> = {}) {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    read_gdrive_config: () => CONFIG,
    oauth_loopback_reserve: () => 49737,
    oauth_loopback_await: () => "AUTH_CODE",
    ...over,
  };
  const invoke = vi.fn((cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    const h = handlers[cmd];
    return h ? Promise.resolve(h(args ?? {})) : Promise.reject(`no handler: ${cmd}`);
  });
  return { invoke: invoke as unknown as GdriveDepsInvoke, calls };
}
type GdriveDepsInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

describe("[REQ-CLOUD-1] connectGoogleDrive", () => {
  it("runs the handshake (config → reserve → await) and persists tokens", async () => {
    const store = new InMemorySecureStore();
    const { invoke, calls } = fakeInvoke();
    await connectGoogleDrive({ invoke, store, poster: tokenOk, now: () => 1000, random: fixedRandom });

    expect(calls.map((c) => c.cmd)).toEqual([
      "read_gdrive_config",
      "oauth_loopback_reserve",
      "oauth_loopback_await",
    ]);
    // the auth URL carries the loopback redirect + PKCE, and state is forwarded
    const awaitCall = calls[2].args as { authUrl: string; expectedState: string };
    expect(awaitCall.authUrl).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A49737");
    expect(awaitCall.authUrl).toContain("code_challenge_method=S256");
    expect(awaitCall.expectedState).toBeTruthy();
    // tokens landed in the keyring under the gdrive account
    expect((await loadTokens(store, GDRIVE_ACCOUNT))?.accessToken).toBe("AT");
  });

  it("throws auth when Drive isn't configured", async () => {
    const { invoke } = fakeInvoke({ read_gdrive_config: () => null });
    await expect(
      connectGoogleDrive({ invoke, store: new InMemorySecureStore(), poster: tokenOk }),
    ).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("[REQ-CLOUD-1] connection state + provider", () => {
  it("isGoogleDriveConnected reflects stored tokens", async () => {
    const store = new InMemorySecureStore();
    expect(await isGoogleDriveConnected({ store })).toBe(false);
    await store.set(GDRIVE_ACCOUNT, JSON.stringify({ accessToken: "AT", refreshToken: "RT", expiresAt: 9e12 }));
    expect(await isGoogleDriveConnected({ store })).toBe(true);
  });

  it("disconnectGoogleDrive clears the stored tokens", async () => {
    const store = new InMemorySecureStore();
    await store.set(GDRIVE_ACCOUNT, JSON.stringify({ accessToken: "AT", refreshToken: "RT", expiresAt: 9e12 }));
    await disconnectGoogleDrive({ store });
    expect(await loadTokens(store, GDRIVE_ACCOUNT)).toBeNull();
  });

  it("makeGoogleDriveProvider returns a gdrive provider when configured", async () => {
    const { invoke } = fakeInvoke();
    const p = await makeGoogleDriveProvider({ invoke, store: new InMemorySecureStore(), poster: tokenOk });
    expect(p).toBeInstanceOf(GoogleDriveProvider);
    expect(p?.id).toBe("gdrive");
  });

  it("makeGoogleDriveProvider returns null when Drive isn't configured", async () => {
    const { invoke } = fakeInvoke({ read_gdrive_config: () => null });
    expect(await makeGoogleDriveProvider({ invoke, store: new InMemorySecureStore() })).toBeNull();
  });

  it("the built provider's AuthedFetch attaches a fresh bearer token", async () => {
    const store = new InMemorySecureStore();
    await store.set(GDRIVE_ACCOUNT, JSON.stringify({ accessToken: "LIVE_AT", refreshToken: "RT", expiresAt: 9e12 }));
    let seenAuth: string | null = null;
    const { invoke } = fakeInvoke();
    const p = await makeGoogleDriveProvider({
      invoke,
      store,
      poster: tokenOk,
      authedFetchFactory: (getToken) => async (_url, init) => {
        const tok = await getToken();
        seenAuth = `Bearer ${tok}`;
        void init;
        return new Response('{"ok":1}', { headers: { etag: '"r1"' } });
      },
      now: () => 0,
    });
    const r = await (p as GoogleDriveProvider).read("FILEID");
    expect(seenAuth).toBe("Bearer LIVE_AT"); // pulled from the stored token, not expired
    expect(r.rev as Revision).toBe('"r1"');
  });
});

describe("[REQ-CLOUD-1] default (production) deps wiring", () => {
  beforeEach(() => (mockedInvoke as unknown as ReturnType<typeof vi.fn>).mockReset());

  it("uses the real Tauri deps when none are injected", async () => {
    const m = mockedInvoke as unknown as ReturnType<typeof vi.fn>;
    // secure_get (via TauriSecureStore) → null: not connected
    m.mockResolvedValueOnce(null);
    expect(await isGoogleDriveConnected()).toBe(false);
    // read_gdrive_config → a config: builds a provider with default poster/fetch
    m.mockResolvedValueOnce(CONFIG);
    const p = await makeGoogleDriveProvider();
    expect(p).toBeInstanceOf(GoogleDriveProvider);
  });
});
