import { describe, expect, it, vi } from "vitest";
import { LocalProvider, type InvokeFn } from "./local";
import { StorageError } from "./provider";

const asInvoke = (fn: unknown) => fn as InvokeFn;

describe("LocalProvider — maps the StorageProvider seam onto the Tauri fs commands", () => {
  it("read() invokes read_file and returns the content (rev null until S2)", async () => {
    const invoke = vi.fn().mockResolvedValue("# hi");
    const r = await new LocalProvider(asInvoke(invoke)).read("/notes.md");
    expect(r).toEqual({ content: "# hi", rev: null });
    expect(invoke).toHaveBeenCalledWith("read_file", { path: "/notes.md" });
  });

  it("write() invokes write_file with path+content and returns rev null", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const r = await new LocalProvider(asInvoke(invoke)).write("/notes.md", "body");
    expect(r).toEqual({ rev: null });
    expect(invoke).toHaveBeenCalledWith("write_file", { path: "/notes.md", content: "body" });
  });

  it("maps a read failure (Tauri rejects with a string) to StorageError('io')", async () => {
    const invoke = vi.fn().mockRejectedValue("permission denied");
    const p = new LocalProvider(asInvoke(invoke));
    await expect(p.read("/x")).rejects.toBeInstanceOf(StorageError);
    await expect(p.read("/x")).rejects.toMatchObject({ kind: "io", message: "permission denied" });
  });

  it("maps a write failure to StorageError('io')", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("disk full"));
    const p = new LocalProvider(asInvoke(invoke));
    await expect(p.write("/x", "y")).rejects.toMatchObject({ kind: "io", message: "disk full" });
  });

  it("has the local id and no conflict/list/watch capabilities yet", () => {
    const p = new LocalProvider(asInvoke(vi.fn()));
    expect(p.id).toBe("local");
    expect(p.capabilities).toEqual({ conflictDetection: false, list: false, watch: false });
  });

  it("defaults to the real Tauri invoke when none is injected", () => {
    // Construct with no arg so the default-parameter binding (the real `invoke`)
    // is exercised for coverage; we don't call read/write, so no IPC is attempted.
    expect(() => new LocalProvider()).not.toThrow();
  });
});
