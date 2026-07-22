import { describe, expect, it, vi } from "vitest";
import { SafProvider, type InvokeFn } from "./saf";
import { StorageError } from "./provider";

const asInvoke = (fn: unknown) => fn as InvokeFn;

/** An invoke double that dispatches per Rust command name. */
function fakeInvoke(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  return vi.fn((cmd: string, args: Record<string, unknown>) => {
    const h = handlers[cmd];
    return h ? Promise.resolve(h(args)) : Promise.reject(`no handler for ${cmd}`);
  });
}

describe("[REQ-MOBILE-3] SafProvider — seam over the Android SAF Tauri commands", () => {
  it("read() invokes saf_read (by uri) and returns content + rev + display name", async () => {
    const invoke = fakeInvoke({
      saf_read: () => ({ content: "# hi", rev: "1700-4", name: "notes.md" }),
    });
    const uri = "content://com.android.providers.downloads.documents/document/raw%3A...";
    const r = await new SafProvider(asInvoke(invoke)).read(uri);
    expect(r).toEqual({ content: "# hi", rev: "1700-4", name: "notes.md" });
    expect(invoke).toHaveBeenCalledWith("saf_read", { uri });
  });

  it("stat() invokes saf_stat and returns the revision", async () => {
    const invoke = fakeInvoke({ saf_stat: () => "1800-7" });
    expect(await new SafProvider(asInvoke(invoke)).stat("content://x")).toBe("1800-7");
    expect(invoke).toHaveBeenCalledWith("saf_stat", { uri: "content://x" });
  });

  it("write() without an expectedRev writes unconditionally and returns the new rev", async () => {
    const invoke = fakeInvoke({
      saf_stat: () => "20-3",
      saf_write: () => undefined,
    });
    const r = await new SafProvider(asInvoke(invoke)).write("content://x", "abc");
    expect(r).toEqual({ rev: "20-3" });
    expect(invoke).toHaveBeenCalledWith("saf_write", { uri: "content://x", content: "abc" });
    // No conflict-check stat before the write (only the post-write rev stat).
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("write() with a matching expectedRev proceeds", async () => {
    const invoke = fakeInvoke({
      saf_stat: () => "5-1", // current == expected → no conflict, and post-write rev
      saf_write: () => undefined,
    });
    const r = await new SafProvider(asInvoke(invoke)).write("content://x", "y", "5-1");
    expect(r).toEqual({ rev: "5-1" });
  });

  it("write() with a missing file (null current rev) is a new write, not a conflict", async () => {
    let stats = 0;
    const invoke = fakeInvoke({
      saf_stat: () => (stats++ === 0 ? null : "99-2"), // 1st: absent; 2nd: post-write rev
      saf_write: () => undefined,
    });
    const r = await new SafProvider(asInvoke(invoke)).write("content://new", "z", "stale-rev");
    expect(r).toEqual({ rev: "99-2" });
  });

  it("write() throws StorageError('conflict') when the file changed under us", async () => {
    const writes = vi.fn();
    const invoke = fakeInvoke({
      saf_stat: () => "NEW-9", // current != expected
      saf_write: () => {
        writes();
      },
    });
    const p = new SafProvider(asInvoke(invoke));
    await expect(p.write("content://x", "y", "OLD-1")).rejects.toMatchObject({ kind: "conflict" });
    expect(writes).not.toHaveBeenCalled(); // never wrote over their change
  });

  it("maps a read failure (Tauri rejects with a string) to StorageError('io')", async () => {
    const invoke = vi.fn().mockRejectedValue("permission revoked");
    const p = new SafProvider(asInvoke(invoke));
    await expect(p.read("content://x")).rejects.toBeInstanceOf(StorageError);
    await expect(p.read("content://x")).rejects.toMatchObject({
      kind: "io",
      message: "permission revoked",
    });
  });

  it("maps a write failure to StorageError('io')", async () => {
    const invoke = fakeInvoke({
      saf_stat: () => "1-1",
      saf_write: () => {
        throw new Error("document provider gone");
      },
    });
    const p = new SafProvider(asInvoke(invoke));
    await expect(p.write("content://x", "y")).rejects.toMatchObject({
      kind: "io",
      message: "document provider gone",
    });
  });

  it("maps a stat failure to StorageError('io')", async () => {
    const invoke = vi.fn().mockRejectedValue("stat boom");
    await expect(new SafProvider(asInvoke(invoke)).stat("content://x")).rejects.toMatchObject({
      kind: "io",
      message: "stat boom",
    });
  });

  it("shares the local id and supports conflict detection", () => {
    const p = new SafProvider(asInvoke(vi.fn()));
    expect(p.id).toBe("local");
    expect(p.capabilities).toEqual({ conflictDetection: true, list: false, watch: false });
  });

  it("defaults to the real Tauri invoke when none is injected", () => {
    // Construct with no arg so the default-parameter binding (the real `invoke`)
    // is exercised for coverage; we don't call read/write, so no IPC is attempted.
    expect(() => new SafProvider()).not.toThrow();
  });
});
