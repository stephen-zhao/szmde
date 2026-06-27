/**
 * The StorageProvider seam (SPEC §6): the single abstraction the editor shell
 * talks to for file I/O, so the core never knows whether a local disk, a cloud
 * drive, or a network share is behind it. Each backend (LocalProvider now;
 * Google Drive / OneDrive in later M3 slices) implements this interface and maps
 * its failures into the one StorageError taxonomy below — so the shell's handling
 * (retry / offline-queue / re-auth / conflict modal) stays provider-agnostic.
 */

/**
 * Opaque per-file version token for conflict detection (SPEC §6 "etag/mtime").
 * Local backends compose it from `mtime-size`; cloud backends use the service
 * etag. `null` means the provider can't version this file, so conflict detection
 * degrades off (mirrored by `capabilities.conflictDetection`).
 */
export type Revision = string | null;

export interface ReadResult {
  content: string;
  rev: Revision;
}

export interface WriteResult {
  rev: Revision;
}

/** A directory entry from the optional `list()` capability. */
export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface Capabilities {
  /** `write(expectedRev)` is honored as a check-and-set and `stat` is meaningful. */
  conflictDetection: boolean;
  /** `list()` is implemented. */
  list: boolean;
  /** `watch()` live-change notifications are available (best-effort). */
  watch: boolean;
}

export interface StorageProvider {
  readonly id: string;
  readonly capabilities: Capabilities;
  /** Read a file's full contents plus its current revision. */
  read(path: string): Promise<ReadResult>;
  /**
   * Write contents. When `expectedRev` is supplied and the provider supports
   * conflict detection, it is a check-and-set: if the file's current revision no
   * longer matches, the write rejects with StorageError("conflict").
   */
  write(path: string, content: string, expectedRev?: Revision): Promise<WriteResult>;
  /** Current revision without reading the body (for a pre-save conflict check). */
  stat?(path: string): Promise<Revision>;
  /** List a directory (only when `capabilities.list`). */
  list?(path: string): Promise<Entry[]>;
}

/**
 * The single failure taxonomy every backend maps into:
 * - `not-found` — the path/file does not exist.
 * - `conflict`  — the file changed under us (revision mismatch on write).
 * - `offline`   — the backend is unreachable (queue + retry).
 * - `auth`      — credentials are missing/expired (re-authenticate).
 * - `io`        — any other read/write failure.
 */
export type StorageErrorKind = "not-found" | "conflict" | "offline" | "auth" | "io";

export class StorageError extends Error {
  constructor(
    readonly kind: StorageErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
    // Restore the prototype chain so `instanceof StorageError` holds even when
    // compiled down to ES5-style constructors.
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

/**
 * Wrap an unknown thrown value as a StorageError of `kind` (default "io"),
 * preserving its text. An existing StorageError passes through unchanged, so a
 * backend that already classified a failure keeps its kind.
 */
export function toStorageError(e: unknown, kind: StorageErrorKind = "io"): StorageError {
  if (e instanceof StorageError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new StorageError(kind, msg);
}
