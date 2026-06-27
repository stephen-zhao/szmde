import { describe, expect, it } from "vitest";
import { StorageError, toStorageError } from "./provider";

describe("StorageError", () => {
  it("is an Error subclass carrying a kind and the given message", () => {
    const e = new StorageError("conflict", "boom");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(StorageError);
    expect(e.kind).toBe("conflict");
    expect(e.message).toBe("boom");
    expect(e.name).toBe("StorageError");
  });
});

describe("toStorageError", () => {
  it("passes an existing StorageError through unchanged (keeps its kind)", () => {
    const orig = new StorageError("conflict", "c");
    expect(toStorageError(orig)).toBe(orig);
  });

  it("wraps a plain Error as kind 'io' by default, preserving the message", () => {
    const e = toStorageError(new Error("disk gone"));
    expect(e).toBeInstanceOf(StorageError);
    expect(e.kind).toBe("io");
    expect(e.message).toBe("disk gone");
  });

  it("wraps a non-Error thrown value using its string form", () => {
    // Tauri's invoke rejects with a plain string, not an Error.
    const e = toStorageError("permission denied");
    expect(e.kind).toBe("io");
    expect(e.message).toBe("permission denied");
  });

  it("honors an explicit kind override", () => {
    const e = toStorageError(new Error("net down"), "offline");
    expect(e.kind).toBe("offline");
  });
});
