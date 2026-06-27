import { describe, expect, it, vi } from "vitest";
import { LocalProvider, type InvokeFn } from "./local";
import { StorageError } from "./provider";

const asInvoke = (fn: unknown) => fn as InvokeFn;

/** An invoke double that dispatches per Rust command name. */
function fakeInvoke(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  return vi.fn((cmd: string, args: Record<string, unknown>) => {
    const h = handlers[cmd];
    return h ? Promise.resolve(h(args)) : Promise.reject(`no handler for ${cmd}`);
  });
}

describe("[REQ-SAVE-1] LocalProvider — seam over the Tauri fs commands", () => {
  it("read() invokes read_file_meta and returns content + rev", async () => {
    const invoke = fakeInvoke({ read_file_meta: () => ({ content: "# hi", rev: "9-4" }) });
    const r = await new LocalProvider(asInvoke(invoke)).read("/notes.md");
    expect(r).toEqual({ content: "# hi", rev: "9-4" });
    expect(invoke).toHaveBeenCalledWith("read_file_meta", { path: "/notes.md" });
  });

  it("stat() invokes stat_file and returns the revision", async () => {
    const invoke = fakeInvoke({ stat_file: () => "12-7" });
    expect(await new LocalProvider(asInvoke(invoke)).stat("/x")).toBe("12-7");
    expect(invoke).toHaveBeenCalledWith("stat_file", { path: "/x" });
  });

  it("write() without an expectedRev writes unconditionally and returns the new rev", async () => {
    const invoke = fakeInvoke({
      stat_file: () => "20-3",
      write_file: () => undefined,
    });
    const r = await new LocalProvider(asInvoke(invoke)).write("/x", "abc");
    expect(r).toEqual({ rev: "20-3" });
    expect(invoke).toHaveBeenCalledWith("write_file", { path: "/x", content: "abc" });
    // No conflict check stat before the write (only the post-write rev stat).
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("write() with a matching expectedRev proceeds", async () => {
    const invoke = fakeInvoke({
      stat_file: () => "5-1", // current == expected → no conflict, and post-write rev
      write_file: () => undefined,
    });
    const r = await new LocalProvider(asInvoke(invoke)).write("/x", "y", "5-1");
    expect(r).toEqual({ rev: "5-1" });
  });

  it("write() with a missing file (null current rev) is a new write, not a conflict", async () => {
    let stats = 0;
    const invoke = fakeInvoke({
      stat_file: () => (stats++ === 0 ? null : "99-2"), // 1st: absent; 2nd: post-write rev
      write_file: () => undefined,
    });
    const r = await new LocalProvider(asInvoke(invoke)).write("/new.md", "z", "stale-rev");
    expect(r).toEqual({ rev: "99-2" });
  });

  it("write() throws StorageError('conflict') when the file changed under us", async () => {
    const writes = vi.fn();
    const invoke = fakeInvoke({
      stat_file: () => "NEW-9", // current != expected
      write_file: () => {
        writes();
      },
    });
    const p = new LocalProvider(asInvoke(invoke));
    await expect(p.write("/x", "y", "OLD-1")).rejects.toMatchObject({ kind: "conflict" });
    expect(writes).not.toHaveBeenCalled(); // never wrote over their change
  });

  it("maps a read failure (Tauri rejects with a string) to StorageError('io')", async () => {
    const invoke = vi.fn().mockRejectedValue("permission denied");
    const p = new LocalProvider(asInvoke(invoke));
    await expect(p.read("/x")).rejects.toBeInstanceOf(StorageError);
    await expect(p.read("/x")).rejects.toMatchObject({ kind: "io", message: "permission denied" });
  });

  it("maps a write failure to StorageError('io')", async () => {
    const invoke = fakeInvoke({
      stat_file: () => "1-1",
      write_file: () => {
        throw new Error("disk full");
      },
    });
    const p = new LocalProvider(asInvoke(invoke));
    await expect(p.write("/x", "y")).rejects.toMatchObject({ kind: "io", message: "disk full" });
  });

  it("maps a stat failure to StorageError('io')", async () => {
    const invoke = vi.fn().mockRejectedValue("stat boom");
    await expect(new LocalProvider(asInvoke(invoke)).stat("/x")).rejects.toMatchObject({
      kind: "io",
      message: "stat boom",
    });
  });

  it("declares the local id and now supports conflict detection", () => {
    const p = new LocalProvider(asInvoke(vi.fn()));
    expect(p.id).toBe("local");
    expect(p.capabilities).toEqual({ conflictDetection: true, list: false, watch: false });
  });

  it("defaults to the real Tauri invoke when none is injected", () => {
    // Construct with no arg so the default-parameter binding (the real `invoke`)
    // is exercised for coverage; we don't call read/write, so no IPC is attempted.
    expect(() => new LocalProvider()).not.toThrow();
  });
});
