import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock plugin-http so this glue stays in coverage (incl. the default-fetch
// binding) without a Tauri runtime — same pattern as tauri-secure-store.test.ts.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { bearerFetch, httpTokenPoster } from "./tauri-transport";

const mockFetch = tauriFetch as unknown as ReturnType<typeof vi.fn>;
const resp = (o: { ok?: boolean; status?: number; json?: () => Promise<unknown> }) => ({
  ok: o.ok ?? true,
  status: o.status ?? 200,
  json: o.json ?? (async () => ({})),
});

describe("[REQ-CLOUD-1] httpTokenPoster (plugin-http transport)", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs form-encoded and returns {ok,status,body}", async () => {
    mockFetch.mockResolvedValue(resp({ json: async () => ({ access_token: "AT" }) }));
    const out = await httpTokenPoster()("https://oauth2.googleapis.com/token", { a: "1", b: "x y" });
    expect(out).toEqual({ ok: true, status: 200, body: { access_token: "AT" } });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.body).toBe("a=1&b=x+y"); // URLSearchParams form-encoding
  });

  it("returns body null when the response isn't JSON", async () => {
    mockFetch.mockResolvedValue(
      resp({
        ok: false,
        status: 400,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );
    expect(await httpTokenPoster()("https://x/token", {})).toEqual({
      ok: false,
      status: 400,
      body: null,
    });
  });
});

describe("[REQ-CLOUD-1] bearerFetch (plugin-http transport)", () => {
  beforeEach(() => mockFetch.mockReset());

  it("attaches the Authorization bearer and delegates to plugin-http", async () => {
    mockFetch.mockResolvedValue(resp({}));
    await bearerFetch(async () => "TOKEN123")("https://www.googleapis.com/drive/v3/files/ID?alt=media", {
      method: "GET",
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/files/ID");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer TOKEN123");
    expect(init.method).toBe("GET");
  });

  it("merges the bearer with existing init headers (e.g. If-Match)", async () => {
    mockFetch.mockResolvedValue(resp({}));
    await bearerFetch(async () => "T")("https://x", { headers: { "If-Match": '"v1"' } });
    const h = mockFetch.mock.calls[0][1].headers as Headers;
    expect(h.get("Authorization")).toBe("Bearer T");
    expect(h.get("If-Match")).toBe('"v1"');
  });
});
