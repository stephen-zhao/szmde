import { StorageError, type StorageProvider, type WriteResult } from "./provider";
import type { Revision } from "./provider";

/**
 * Offline draft cache + write queue (REQ-SAVE-3, SPEC §6 "queue writes until
 * reconnect"). When a write fails because the backend is unreachable
 * (`StorageError("offline")`), the content is stashed so a dropped connection
 * never loses work, and the write is queued to retry on reconnect. Writes to the
 * same file coalesce to the latest content (no point replaying stale versions).
 *
 * This is provider-agnostic and fully unit-tested here; it activates in the shell
 * once a backend that can actually report `offline` (a cloud provider, M3 S7/S8)
 * is wired in with an online/offline signal. A local disk never goes offline.
 */
export interface PendingWrite {
  providerId: string;
  path: string;
  content: string;
  expectedRev: Revision;
}

/**
 * Durable backing for the queue so drafts survive a restart. Raw list I/O only
 * (the queue owns coalescing/ordering). In-memory double for tests; a local-dir /
 * IndexedDB impl is the platform integration tail.
 */
export interface DraftStore {
  /** Restore the persisted queue (e.g. after a restart). */
  load(): Promise<PendingWrite[]>;
  /** Persist the current queue wholesale. */
  persist(items: PendingWrite[]): Promise<void>;
}

/** Test double + reasonable web fallback. */
export class InMemoryDraftStore implements DraftStore {
  items: PendingWrite[] = [];
  loadCount = 0;

  constructor(seed?: PendingWrite[]) {
    if (seed) this.items = [...seed];
  }
  async load(): Promise<PendingWrite[]> {
    this.loadCount++;
    return [...this.items];
  }
  async persist(items: PendingWrite[]): Promise<void> {
    this.items = [...items];
  }
}

export class OfflineQueue {
  #store: DraftStore;
  // Insertion-ordered; one entry per file (re-enqueuing a file updates its
  // content in place, coalescing — Map keeps the original position).
  #pending = new Map<string, PendingWrite>();

  constructor(store: DraftStore) {
    this.#store = store;
  }

  static key(providerId: string, path: string): string {
    return `${providerId}:${path}`;
  }

  /** Restore drafts persisted from a previous session. */
  async load(): Promise<void> {
    for (const w of await this.#store.load()) {
      this.#pending.set(OfflineQueue.key(w.providerId, w.path), w);
    }
  }

  get size(): number {
    return this.#pending.size;
  }

  /** The draft pending for a file, if any (so the editor can recover it). */
  draft(providerId: string, path: string): PendingWrite | undefined {
    return this.#pending.get(OfflineQueue.key(providerId, path));
  }

  /** Queue a write (or coalesce onto an existing one for the same file). */
  async enqueue(w: PendingWrite): Promise<void> {
    this.#pending.set(OfflineQueue.key(w.providerId, w.path), w);
    await this.#persist();
  }

  /**
   * Replay queued writes through `write`. Stops at the first `offline` failure
   * (still down — keep the rest for next time); any other error drops that item
   * (the caller has surfaced it) and continues. Returns how many were flushed.
   */
  async flush(write: (w: PendingWrite) => Promise<unknown>): Promise<number> {
    let flushed = 0;
    for (const [key, w] of [...this.#pending]) {
      try {
        await write(w);
        this.#pending.delete(key);
        flushed++;
      } catch (e) {
        if (e instanceof StorageError && e.kind === "offline") break; // still offline
        this.#pending.delete(key); // non-offline error → drop (surfaced elsewhere)
      }
    }
    await this.#persist();
    return flushed;
  }

  async #persist(): Promise<void> {
    await this.#store.persist([...this.#pending.values()]);
  }
}

/**
 * Write through a provider, queueing on `offline` instead of failing. Returns the
 * WriteResult on success, or `null` when the write was queued (offline). Any other
 * error (conflict / auth / io) propagates for the caller to handle.
 */
export async function queuedWrite(
  provider: StorageProvider,
  queue: OfflineQueue,
  w: PendingWrite,
): Promise<WriteResult | null> {
  try {
    return await provider.write(w.path, w.content, w.expectedRev);
  } catch (e) {
    if (e instanceof StorageError && e.kind === "offline") {
      await queue.enqueue(w);
      return null;
    }
    throw e;
  }
}
