import { describe, expect, it } from "vitest";
import { OneDriveProvider } from "./onedrive";
import type { AuthedFetch } from "./cloud-http";

const res = (body: string | null, init?: ResponseInit) => new Response(body, init);
const headers = (init?: RequestInit) => (init?.headers ?? {}) as Record<string, string>;

function capturing(response: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: AuthedFetch = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { fetch, calls };
}

const provider = (fetch: AuthedFetch) => new OneDriveProvider(fetch);
const ITEM = "https://graph.microsoft.com/v1.0/me/drive/items";

describe("[REQ-CLOUD-2] OneDriveProvider", () => {
  it("reads content + etag rev via the Graph item content endpoint", async () => {
    const { fetch, calls } = capturing(() => res("# hi", { headers: { etag: '"v1"' } }));
    const r = await provider(fetch).read("ITEMID");
    expect(r).toEqual({ content: "# hi", rev: '"v1"' });
    expect(calls[0].url).toBe(`${ITEM}/ITEMID/content`);
  });

  it("stat returns the etag from a metadata request", async () => {
    const { fetch, calls } = capturing(() => res(null, { headers: { etag: '"v9"' } }));
    expect(await provider(fetch).stat("ID")).toBe('"v9"');
    expect(calls[0].url).toBe(`${ITEM}/ID?select=eTag`);
  });

  it("writes via PUT with an If-Match header when given an expectedRev", async () => {
    const { fetch, calls } = capturing(() => res(null, { headers: { etag: '"v2"' } }));
    const r = await provider(fetch).write("ID", "body", '"v1"');
    expect(r).toEqual({ rev: '"v2"' });
    expect(calls[0].url).toBe(`${ITEM}/ID/content`);
    expect(calls[0].init?.method).toBe("PUT");
    expect(headers(calls[0].init)["If-Match"]).toBe('"v1"');
    expect(calls[0].init?.body).toBe("body");
  });

  it("writes without an If-Match header when no expectedRev is given", async () => {
    const { fetch, calls } = capturing(() => res(null, { headers: { etag: '"v2"' } }));
    await provider(fetch).write("ID", "body");
    expect(headers(calls[0].init)["If-Match"]).toBeUndefined();
  });

  it("falls back to a metadata stat when the write response carries no etag", async () => {
    let n = 0;
    const fetch: AuthedFetch = async () =>
      n++ === 0 ? res(null) : res(null, { headers: { etag: '"v3"' } });
    expect(await provider(fetch).write("ID", "x")).toEqual({ rev: '"v3"' });
    expect(n).toBe(2);
  });

  it("maps 412 → conflict, 401 → auth, 404 → not-found, network → offline", async () => {
    const at = (status: number) => provider((async () => res(null, { status })) as AuthedFetch);
    await expect(at(412).write("ID", "x", '"old"')).rejects.toMatchObject({ kind: "conflict" });
    await expect(at(401).read("ID")).rejects.toMatchObject({ kind: "auth" });
    await expect(at(404).read("ID")).rejects.toMatchObject({ kind: "not-found" });
    const down: AuthedFetch = async () => {
      throw new Error("no net");
    };
    await expect(provider(down).read("ID")).rejects.toMatchObject({ kind: "offline" });
  });

  it("declares the onedrive id and conflict-detection capability", () => {
    const p = provider((async () => res(null)) as AuthedFetch);
    expect(p.id).toBe("onedrive");
    expect(p.capabilities).toEqual({ conflictDetection: true, list: false, watch: false });
  });
});
