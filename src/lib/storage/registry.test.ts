import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./registry";
import { StorageError, type StorageProvider } from "./provider";

function fake(id: string): StorageProvider {
  return {
    id,
    capabilities: { conflictDetection: false, list: false, watch: false },
    read: async () => ({ content: "", rev: null }),
    write: async () => ({ rev: null }),
  };
}

describe("ProviderRegistry", () => {
  it("resolves a registered provider by id", () => {
    const local = fake("local");
    const reg = new ProviderRegistry([local], "local");
    expect(reg.get("local")).toBe(local);
  });

  it("throws StorageError for an unknown id", () => {
    const reg = new ProviderRegistry([fake("local")], "local");
    expect(() => reg.get("nope")).toThrow(StorageError);
  });

  it("uses the explicit defaultId for .default", () => {
    const gdrive = fake("gdrive");
    const reg = new ProviderRegistry([fake("local"), gdrive], "gdrive");
    expect(reg.default).toBe(gdrive);
  });

  it("falls back to the first registered provider when no defaultId is given", () => {
    const local = fake("local");
    const reg = new ProviderRegistry([local, fake("gdrive")]);
    expect(reg.default).toBe(local);
  });

  it("an empty registry's .default throws (no providers to resolve)", () => {
    const reg = new ProviderRegistry([]);
    expect(() => reg.default).toThrow(StorageError);
  });
});
