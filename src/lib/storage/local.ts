import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  StorageError,
  toStorageError,
  type Capabilities,
  type ReadResult,
  type Revision,
  type StorageProvider,
  type WriteResult,
} from "./provider";

/** The Tauri IPC signature, narrowed to what this backend needs. Injected so the
 *  mapping is unit-testable with a fake; the default is the real Tauri `invoke`. */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Shape returned by the Rust `read_file_meta` command. */
interface FileMeta {
  content: string;
  rev: string;
}

/**
 * The desktop local-filesystem backend (SPEC §6): maps the StorageProvider seam
 * onto the Rust `read_file_meta` / `stat_file` / `write_file` Tauri commands
 * (src-tauri/src/lib.rs), which already handle Windows UNC / WSL paths (§6.1).
 * EOL transform stays ABOVE the provider (the shell), so this backend deals in
 * the exact on-disk bytes.
 *
 * Conflict detection (REQ-SAVE-1): a file's revision is `{mtime_nanos}-{len}`.
 * `write(path, content, expectedRev)` stats the file first and rejects with
 * StorageError("conflict") if it changed under us. Local check-and-set is
 * best-effort (a tiny TOCTOU window between stat and write); a true atomic CAS
 * isn't available through std::fs, which is acceptable for a local disk.
 */
export class LocalProvider implements StorageProvider {
  readonly id = "local";
  readonly capabilities: Capabilities = {
    conflictDetection: true,
    list: false,
    watch: false,
  };

  #invoke: InvokeFn;
  constructor(invoke: InvokeFn = tauriInvoke) {
    this.#invoke = invoke;
  }

  async read(path: string): Promise<ReadResult> {
    try {
      const { content, rev } = await this.#invoke<FileMeta>("read_file_meta", { path });
      return { content, rev };
    } catch (e) {
      throw toStorageError(e);
    }
  }

  async stat(path: string): Promise<Revision> {
    try {
      return await this.#invoke<Revision>("stat_file", { path });
    } catch (e) {
      throw toStorageError(e);
    }
  }

  async write(path: string, content: string, expectedRev?: Revision): Promise<WriteResult> {
    try {
      // Pre-write conflict check: only when a baseline rev was supplied. A null
      // current rev means the file is gone (e.g. a fresh Save As target) — not a
      // conflict, just a new write.
      if (expectedRev != null) {
        const current = await this.#invoke<Revision>("stat_file", { path });
        if (current !== null && current !== expectedRev) {
          throw new StorageError("conflict", `file changed on disk: ${path}`);
        }
      }
      await this.#invoke<void>("write_file", { path, content });
      const rev = await this.#invoke<Revision>("stat_file", { path });
      return { rev };
    } catch (e) {
      throw toStorageError(e);
    }
  }
}
