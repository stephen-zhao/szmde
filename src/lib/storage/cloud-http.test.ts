import { describe, expect, it } from "vitest";
import { cloudRequest, mapStatus, type AuthedFetch } from "./cloud-http";
import { StorageError } from "./provider";

describe("[REQ-CLOUD-1][REQ-CLOUD-2] cloud-http", () => {
  it("mapStatus classifies HTTP statuses into StorageError kinds", () => {
    expect(mapStatus(401)).toBe("auth");
    expect(mapStatus(403)).toBe("auth");
    expect(mapStatus(404)).toBe("not-found");
    expect(mapStatus(412)).toBe("conflict");
    expect(mapStatus(500)).toBe("io");
  });

  it("cloudRequest returns the response on success", async () => {
    const fetch: AuthedFetch = async () => new Response("ok", { status: 200 });
    expect(await (await cloudRequest(fetch, "https://x/y")).text()).toBe("ok");
  });

  it("cloudRequest maps a non-OK response to the status's kind (and names the method)", async () => {
    const fetch: AuthedFetch = async () => new Response(null, { status: 412 });
    await expect(cloudRequest(fetch, "https://x", { method: "PATCH" })).rejects.toMatchObject({
      kind: "conflict",
    });
  });

  it("cloudRequest maps a thrown fetch (no network) to offline", async () => {
    const fetch: AuthedFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(cloudRequest(fetch, "https://x")).rejects.toBeInstanceOf(StorageError);
    await expect(cloudRequest(fetch, "https://x")).rejects.toMatchObject({
      kind: "offline",
      message: "ECONNREFUSED",
    });
  });

  it("cloudRequest offline message handles a non-Error throw", async () => {
    const fetch: AuthedFetch = async () => {
      throw "boom";
    };
    await expect(cloudRequest(fetch, "https://x")).rejects.toMatchObject({
      kind: "offline",
      message: "boom",
    });
  });
});
