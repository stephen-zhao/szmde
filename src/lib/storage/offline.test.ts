import { describe, expect, it, vi } from "vitest";
import {
  InMemoryDraftStore,
  OfflineQueue,
  queuedWrite,
  type PendingWrite,
} from "./offline";
import { StorageError, type StorageProvider } from "./provider";

const w = (path: string, content = "x", expectedRev: string | null = null): PendingWrite => ({
  providerId: "gdrive",
  path,
  content,
  expectedRev,
});

describe("[REQ-SAVE-3] OfflineQueue", () => {
  it("enqueues a write and exposes it as a recoverable draft", async () => {
    const store = new InMemoryDraftStore();
    const q = new OfflineQueue(store);
    await q.enqueue(w("/a.md", "hello"));
    expect(q.size).toBe(1);
    expect(q.draft("gdrive", "/a.md")?.content).toBe("hello");
    expect(q.draft("gdrive", "/missing.md")).toBeUndefined();
    expect(store.items).toHaveLength(1); // persisted durably
  });

  it("coalesces repeated writes to the same file to the latest content", async () => {
    const q = new OfflineQueue(new InMemoryDraftStore());
    await q.enqueue(w("/a.md", "v1"));
    await q.enqueue(w("/a.md", "v2"));
    expect(q.size).toBe(1);
    expect(q.draft("gdrive", "/a.md")?.content).toBe("v2");
  });

  it("flushes queued writes in insertion order and clears them", async () => {
    const q = new OfflineQueue(new InMemoryDraftStore());
    await q.enqueue(w("/a.md"));
    await q.enqueue(w("/b.md"));
    await q.enqueue(w("/c.md"));
    const order: string[] = [];
    const flushed = await q.flush(async (p) => {
      order.push(p.path);
    });
    expect(order).toEqual(["/a.md", "/b.md", "/c.md"]);
    expect(flushed).toBe(3);
    expect(q.size).toBe(0);
  });

  it("stops flushing at the first still-offline failure, keeping the rest", async () => {
    const q = new OfflineQueue(new InMemoryDraftStore());
    await q.enqueue(w("/a.md"));
    await q.enqueue(w("/b.md"));
    await q.enqueue(w("/c.md"));
    const flushed = await q.flush(async (p) => {
      if (p.path === "/b.md") throw new StorageError("offline", "still down");
    });
    expect(flushed).toBe(1); // only /a.md got out
    expect(q.size).toBe(2); // /b.md + /c.md remain (in order)
    expect([...["/b.md", "/c.md"]].every((p) => q.draft("gdrive", p))).toBe(true);
  });

  it("drops an item that fails with a non-offline error and continues", async () => {
    const q = new OfflineQueue(new InMemoryDraftStore());
    await q.enqueue(w("/a.md"));
    await q.enqueue(w("/bad.md"));
    await q.enqueue(w("/c.md"));
    const flushed = await q.flush(async (p) => {
      if (p.path === "/bad.md") throw new StorageError("io", "gone");
    });
    expect(flushed).toBe(2); // /a.md + /c.md
    expect(q.size).toBe(0); // /bad.md was dropped, not retried forever
  });

  it("restores drafts persisted from a previous session", async () => {
    const store = new InMemoryDraftStore([w("/a.md", "draft-a"), w("/b.md", "draft-b")]);
    const q = new OfflineQueue(store);
    await q.load();
    expect(store.loadCount).toBe(1);
    expect(q.size).toBe(2);
    expect(q.draft("gdrive", "/a.md")?.content).toBe("draft-a");
  });
});

describe("[REQ-SAVE-3] queuedWrite", () => {
  function provider(write: StorageProvider["write"]): StorageProvider {
    return {
      id: "gdrive",
      capabilities: { conflictDetection: true, list: false, watch: false },
      read: async () => ({ content: "", rev: null }),
      write,
    };
  }

  it("returns the WriteResult and queues nothing on success", async () => {
    const q = new OfflineQueue(new InMemoryDraftStore());
    const p = provider(vi.fn(async () => ({ rev: "1-1" })));
    const r = await queuedWrite(p, q, w("/a.md"));
    expect(r).toEqual({ rev: "1-1" });
    expect(q.size).toBe(0);
  });

  it("queues the write and returns null when the backend is offline", async () => {
    const q = new OfflineQueue(new InMemoryDraftStore());
    const p = provider(async () => {
      throw new StorageError("offline", "no network");
    });
    const r = await queuedWrite(p, q, w("/a.md", "unsaved"));
    expect(r).toBeNull();
    expect(q.size).toBe(1);
    expect(q.draft("gdrive", "/a.md")?.content).toBe("unsaved");
  });

  it("propagates a non-offline error (conflict/io/auth) without queueing", async () => {
    const q = new OfflineQueue(new InMemoryDraftStore());
    const p = provider(async () => {
      throw new StorageError("conflict", "changed");
    });
    await expect(queuedWrite(p, q, w("/a.md"))).rejects.toMatchObject({ kind: "conflict" });
    expect(q.size).toBe(0);
  });
});
