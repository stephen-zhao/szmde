import { describe, expect, it } from "vitest";
import { InMemorySettingsBackend } from "./backend";

describe("[REQ-SET-1] InMemorySettingsBackend", () => {
  it("returns null for both tiers when unseeded (first run)", async () => {
    const b = new InMemorySettingsBackend();
    expect(await b.readSystem()).toBeNull();
    expect(await b.readUser()).toBeNull();
  });

  it("returns seeded text", async () => {
    const b = new InMemorySettingsBackend({ system: "{sys}", user: "{usr}" });
    expect(await b.readSystem()).toBe("{sys}");
    expect(await b.readUser()).toBe("{usr}");
  });

  it("writeUser stores the text and records the write", async () => {
    const b = new InMemorySettingsBackend();
    await b.writeUser("{a:1}");
    expect(b.lastWritten).toBe("{a:1}");
    expect(b.writeCount).toBe(1);
    expect(await b.readUser()).toBe("{a:1}");
  });

  it("rejects reads/writes when the failure flags are set", async () => {
    const b = new InMemorySettingsBackend();
    b.failReadUser = true;
    await expect(b.readUser()).rejects.toThrow();
    b.failReadUser = false;
    b.failWriteUser = true;
    await expect(b.writeUser("x")).rejects.toThrow();
  });
});
