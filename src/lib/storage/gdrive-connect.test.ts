import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri modules so the production default deps (resolved()) are callable
// for the default-coverage tests without a Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({ onOpenUrl: vi.fn(), getCurrent: vi.fn() }));
import { invoke as mockedInvoke } from "@tauri-apps/api/core";
import {
  GDRIVE_ACCOUNT,
  connectGoogleDrive,
  disconnectGoogleDrive,
  isGoogleDriveConnected,
  makeGoogleDriveProvider,
  parseDeepLinkRedirect,
  pickGoogleDriveFiles,
  type GdriveDeps,
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
    oauth_pick_await: () => ({ code: "PICK_CODE", pickedFileIds: "ID1,ID2" }),
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
    // scope stays the least-privilege drive.file (REQ-CLOUD-3), never the full drive
    expect(awaitCall.authUrl).toContain("drive.file");
    expect(awaitCall.authUrl).not.toContain("auth%2Fdrive&"); // no bare full-drive scope
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

describe("[REQ-CLOUD-3] pickGoogleDriveFiles — system-browser Picker under drive.file", () => {
  it("runs the pick flow, persists tokens (pick doubles as sign-in), returns the ids", async () => {
    const store = new InMemorySecureStore();
    const { invoke, calls } = fakeInvoke();
    const ids = await pickGoogleDriveFiles({ invoke, store, poster: tokenOk, now: () => 1000, random: fixedRandom });

    expect(calls.map((c) => c.cmd)).toEqual([
      "read_gdrive_config",
      "oauth_loopback_reserve",
      "oauth_pick_await", // NOT oauth_loopback_await — the pick command returns pickedFileIds too
    ]);
    // the auth URL is a Picker session: trigger_onepick + consent + the NARROW scope only
    const awaitCall = calls[2].args as { authUrl: string; expectedState: string };
    expect(awaitCall.authUrl).toContain("trigger_onepick=true");
    expect(awaitCall.authUrl).not.toContain("allow_multiple"); // single-doc open; no multi-select
    expect(awaitCall.authUrl).toContain("prompt=consent");
    expect(awaitCall.authUrl).toContain("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file");
    expect(awaitCall.authUrl).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A49737");
    expect(awaitCall.authUrl).toContain("code_challenge_method=S256");
    // ids parsed from Google's comma-separated param
    expect(ids).toEqual(["ID1", "ID2"]);
    // the pick's code exchange persisted tokens — no separate connect needed
    expect((await loadTokens(store, GDRIVE_ACCOUNT))?.accessToken).toBe("AT");
  });

  it("returns [] when consent completed but nothing was picked", async () => {
    const { invoke } = fakeInvoke({ oauth_pick_await: () => ({ code: "C", pickedFileIds: null }) });
    const ids = await pickGoogleDriveFiles({
      invoke, store: new InMemorySecureStore(), poster: tokenOk, now: () => 0, random: fixedRandom,
    });
    expect(ids).toEqual([]);
  });

  it("throws auth when Drive isn't configured", async () => {
    const { invoke } = fakeInvoke({ read_gdrive_config: () => null });
    await expect(
      pickGoogleDriveFiles({ invoke, store: new InMemorySecureStore(), poster: tokenOk }),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("propagates a declined/cancelled consent from the Rust command", async () => {
    const { invoke } = fakeInvoke({
      oauth_pick_await: () => Promise.reject("sign-in was declined: access_denied"),
    });
    await expect(
      pickGoogleDriveFiles({
        invoke, store: new InMemorySecureStore(), poster: tokenOk, random: fixedRandom,
      }),
    ).rejects.toMatch(/declined/);
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

const APP_LINK = "https://zhaostephen.com/szmde/oauth2redirect";

/** A TokenPoster that records each exchange form (to assert the redirect_uri echo). */
function recordingPoster() {
  const forms: Record<string, string>[] = [];
  const post: TokenPoster = async (_url, form) => {
    forms.push(form);
    return { ok: true, status: 200, body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 } };
  };
  return { post, forms };
}

/** Controllable Android deep-link deps: the redirect `handler` and deadline `timerFn`
 *  are captured so a test can fire them (Google's redirect / the deadline). */
function androidDeps(over: Partial<GdriveDeps> = {}) {
  const s = {
    launched: null as string | null,
    handler: null as ((u: string[]) => void) | null,
    timerFn: null as (() => void) | null,
    unlisten: vi.fn(),
    cleared: [] as unknown[],
  };
  const { invoke, calls } = fakeInvoke();
  const { post, forms } = recordingPoster();
  const deps: GdriveDeps = {
    invoke,
    store: new InMemorySecureStore(),
    poster: post,
    now: () => 1000,
    random: fixedRandom,
    isAndroid: () => true,
    getCurrentDeepLink: async () => null,
    onOpenUrl: async (h) => {
      s.handler = h;
      return s.unlisten;
    },
    openUrl: async (url) => {
      s.launched = url;
    },
    setTimer: (fn) => {
      s.timerFn = fn as () => void;
      return "TIMER";
    },
    clearTimer: (h) => {
      s.cleared.push(h);
    },
    ...over,
  };
  return { deps, s, forms, calls };
}

const stateOf = (url: string) => new URL(url).searchParams.get("state") ?? "";

describe("parseDeepLinkRedirect", () => {
  it("pulls code + state from the redirect query", () =>
    expect(parseDeepLinkRedirect(`${APP_LINK}?code=AC&state=ST`)).toEqual({
      code: "AC",
      state: "ST",
      error: undefined,
    }));
  it("pulls the error param when consent is declined", () =>
    expect(parseDeepLinkRedirect(`${APP_LINK}?error=access_denied&state=ST`)).toEqual({
      code: undefined,
      state: "ST",
      error: "access_denied",
    }));
  it("is all-undefined when the query carries none of them", () =>
    expect(parseDeepLinkRedirect(APP_LINK)).toEqual({ code: undefined, state: undefined, error: undefined }));
});

describe("[REQ-CLOUD-1] connectGoogleDrive on Android (deep-link redirect)", () => {
  it("launches the Custom Tab, captures the App Link redirect, persists tokens (no loopback)", async () => {
    const { deps, s, forms, calls } = androidDeps();
    deps.openUrl = async (url) => {
      s.launched = url;
      s.handler!([`${APP_LINK}?code=AC&state=${stateOf(url)}`]); // Google redirects back
    };
    await connectGoogleDrive(deps);

    expect(calls.map((c) => c.cmd)).toEqual(["read_gdrive_config"]); // NO oauth_loopback_* on mobile
    expect(s.launched).toContain("redirect_uri=https%3A%2F%2Fzhaostephen.com%2Fszmde%2Foauth2redirect");
    expect(s.launched).toContain("code_challenge_method=S256");
    expect(s.launched).toContain("drive.file");
    expect(forms[0].redirect_uri).toBe(APP_LINK); // the token exchange echoes the identical App Link
    expect((await loadTokens(deps.store!, GDRIVE_ACCOUNT))?.accessToken).toBe("AT");
    expect(s.unlisten).toHaveBeenCalledTimes(1);
    expect(s.cleared).toEqual(["TIMER"]);
    // a late duplicate redirect is ignored (finish's done-guard)
    s.handler!([`${APP_LINK}?code=AC2&state=${stateOf(s.launched!)}`]);
    expect(s.unlisten).toHaveBeenCalledTimes(1);
  });

  it("ignores foreign-state and unparseable redirects, waiting for the state match", async () => {
    const { deps, s } = androidDeps();
    deps.openUrl = async (url) => {
      s.launched = url;
      s.handler!(["not-a-url", `${APP_LINK}?code=X&state=forged`]); // both ignored — keep waiting
      s.handler!([`${APP_LINK}?code=AC&state=${stateOf(url)}`]); // ours → resolves
    };
    await connectGoogleDrive(deps);
    expect((await loadTokens(deps.store!, GDRIVE_ACCOUNT))?.accessToken).toBe("AT");
  });

  it("reopens from a cold-start redirect via getCurrent (Custom Tab never opens)", async () => {
    // Learn the deterministic state (fixedRandom) from a normal connect...
    const first = androidDeps();
    first.deps.openUrl = async (url) => {
      first.s.launched = url;
      first.s.handler!([`${APP_LINK}?code=AC&state=${stateOf(url)}`]);
    };
    await connectGoogleDrive(first.deps);
    const st = stateOf(first.s.launched!);
    // ...then a cold start where getCurrent already holds the (same) redirect.
    const { deps, s } = androidDeps({ getCurrentDeepLink: async () => [`${APP_LINK}?code=CS&state=${st}`] });
    await connectGoogleDrive(deps);
    expect((await loadTokens(deps.store!, GDRIVE_ACCOUNT))?.accessToken).toBe("AT");
    expect(s.launched).toBeNull(); // early return → no tab, no listener
  });

  it("maps a declined consent (error param, our state) to StorageError auth", async () => {
    const { deps, s } = androidDeps();
    deps.openUrl = async (url) => {
      s.launched = url;
      s.handler!([`${APP_LINK}?error=access_denied&state=${stateOf(url)}`]);
    };
    await expect(connectGoogleDrive(deps)).rejects.toMatchObject({
      kind: "auth",
      message: expect.stringMatching(/declined.*access_denied/),
    });
  });

  it("rejects auth when the redirect matches our state but carries no code", async () => {
    const { deps, s } = androidDeps();
    deps.openUrl = async (url) => {
      s.launched = url;
      s.handler!([`${APP_LINK}?state=${stateOf(url)}`]);
    };
    await expect(connectGoogleDrive(deps)).rejects.toMatchObject({ kind: "auth" });
  });

  it("times out (auth) when the tab is closed with no redirect, and unlistens", async () => {
    const { deps, s } = androidDeps();
    deps.openUrl = async (url) => {
      s.launched = url;
      s.timerFn!(); // the deadline passes with no redirect
    };
    await expect(connectGoogleDrive(deps)).rejects.toMatchObject({
      kind: "auth",
      message: expect.stringMatching(/timed out/),
    });
    expect(s.unlisten).toHaveBeenCalledTimes(1);
    expect(s.cleared).toEqual(["TIMER"]);
  });

  it("rejects auth if the deep-link listener fails to register (no timer/launch)", async () => {
    const { deps, s } = androidDeps({
      onOpenUrl: async () => {
        throw new StorageError("auth", "listener registration failed");
      },
    });
    await expect(connectGoogleDrive(deps)).rejects.toMatchObject({ kind: "auth" });
    expect(s.launched).toBeNull(); // launch never ran (listener failed first)
    expect(s.unlisten).not.toHaveBeenCalled();
    expect(s.cleared).toEqual([]); // no deadline was armed
  });

  it("wires resolved()'s default deep-link deps (mocked plugins) end to end", async () => {
    const opener = await import("@tauri-apps/plugin-opener");
    const deepLink = await import("@tauri-apps/plugin-deep-link");
    const openUrlMock = vi.mocked(opener.openUrl);
    const onOpenMock = vi.mocked(deepLink.onOpenUrl);
    const getCurrentMock = vi.mocked(deepLink.getCurrent);
    let handler: ((u: string[]) => void) | null = null;
    getCurrentMock.mockResolvedValue(null);
    onOpenMock.mockImplementation((async (h: (u: string[]) => void) => {
      handler = h;
      return () => {};
    }) as never);
    openUrlMock.mockImplementation((async (url: string) => {
      handler!([`${APP_LINK}?code=AC&state=${stateOf(url)}`]);
    }) as never);

    const store = new InMemorySecureStore();
    const { invoke } = fakeInvoke();
    const { post } = recordingPoster();
    // Only isAndroid is injected; openUrl / onOpenUrl / getCurrent / setTimer / clearTimer
    // all fall through to resolved()'s real defaults (the mocked plugins + setTimeout).
    await connectGoogleDrive({ isAndroid: () => true, invoke, store, poster: post, now: () => 1000, random: fixedRandom });
    expect(openUrlMock).toHaveBeenCalledOnce();
    expect((await loadTokens(store, GDRIVE_ACCOUNT))?.accessToken).toBe("AT");
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
