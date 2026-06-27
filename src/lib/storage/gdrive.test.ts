import { describe, expect, it } from "vitest";
import { GoogleDriveProvider } from "./gdrive";
import type { AuthedFetch } from "./cloud-http";

const res = (body: string | null, init?: ResponseInit) => new Response(body, init);
const headers = (init?: RequestInit) => (init?.headers ?? {}) as Record<string, string>;

/** A fetch double that records the last call and returns a fixed response. */
function capturing(response: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: AuthedFetch = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { fetch, calls };
}

const provider = (fetch: AuthedFetch) => new GoogleDriveProvider(fetch);

describe("[REQ-CLOUD-1] GoogleDriveProvider", () => {
  it("reads content + etag rev via the files media endpoint", async () => {
    const { fetch, calls } = capturing(() => res("# hi", { headers: { etag: '"v1"' } }));
    const r = await provider(fetch).read("FILEID");
    expect(r).toEqual({ content: "# hi", rev: '"v1"' });
    expect(calls[0].url).toBe("https://www.googleapis.com/drive/v3/files/FILEID?alt=media");
  });

  it("stat returns the etag from a metadata request", async () => {
    const { fetch, calls } = capturing(() => res(null, { headers: { etag: '"v9"' } }));
    expect(await provider(fetch).stat("ID")).toBe('"v9"');
    expect(calls[0].url).toBe("https://www.googleapis.com/drive/v3/files/ID?fields=id");
  });

  it("writes with an If-Match header when given an expectedRev, returning the new etag", async () => {
    const { fetch, calls } = capturing(() => res(null, { headers: { etag: '"v2"' } }));
    const r = await provider(fetch).write("ID", "body", '"v1"');
    expect(r).toEqual({ rev: '"v2"' });
    expect(calls[0].url).toBe("https://www.googleapis.com/upload/drive/v3/files/ID?uploadType=media");
    expect(calls[0].init?.method).toBe("PATCH");
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
    expect(n).toBe(2); // write, then the stat fallback
  });

  it("maps 412 → conflict, 401 → auth, 404 → not-found", async () => {
    const at = (status: number) => provider((async () => res(null, { status })) as AuthedFetch);
    await expect(at(412).write("ID", "x", '"old"')).rejects.toMatchObject({ kind: "conflict" });
    await expect(at(401).read("ID")).rejects.toMatchObject({ kind: "auth" });
    await expect(at(404).read("ID")).rejects.toMatchObject({ kind: "not-found" });
  });

  it("maps a network failure to offline", async () => {
    const fetch: AuthedFetch = async () => {
      throw new Error("offline!");
    };
    await expect(provider(fetch).read("ID")).rejects.toMatchObject({ kind: "offline" });
  });

  it("declares the gdrive id and conflict-detection capability", () => {
    const p = provider((async () => res(null)) as AuthedFetch);
    expect(p.id).toBe("gdrive");
    expect(p.capabilities).toEqual({ conflictDetection: true, list: false, watch: false });
  });
});
