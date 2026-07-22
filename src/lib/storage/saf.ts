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

/** Shape returned by the Rust `saf_read` command. */
interface SafMeta {
  content: string;
  rev: string;
  name: string;
}

/**
 * The Android Storage Access Framework backend (SPEC §6, REQ-MOBILE-3): maps the
 * StorageProvider seam onto the Rust `saf_read` / `saf_stat` / `saf_write` Tauri
 * commands, which operate on scoped-storage `content://` URIs (the seam's `path`
 * argument carries the URI string). It is the exact structural mirror of
 * `LocalProvider` — only the command names, the `{ uri }` argument key, and the
 * display-name passthrough differ — so the shell's open/save call sites are
 * unchanged: it shares the id `"local"` and is constructed in place of
 * `LocalProvider` on Android (see `platform.ts` / `+page.svelte`).
 *
 * EOL transform stays ABOVE the provider (the shell), so this backend deals in
 * the exact on-disk bytes, exactly like Local.
 *
 * Conflict detection (REQ-SAVE-1): the Rust side composes a file's revision from
 * `{DocumentFile.lastModified()}-{byteLength}` — both of which change on write
 * (verified on-device, M6 S4 Phase A) — so the same pre-write check-and-set works
 * verbatim. `write(uri, content, expectedRev)` stats first and rejects with
 * StorageError("conflict") if the file changed under us.
 */
export class SafProvider implements StorageProvider {
  // Shares the shell's "local" slot: on Android this is constructed in place of
  // LocalProvider, so providerFor()/open/save call sites need no change.
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
      const { content, rev, name } = await this.#invoke<SafMeta>("saf_read", { uri: path });
      return { content, rev, name };
    } catch (e) {
      throw toStorageError(e);
    }
  }

  async stat(path: string): Promise<Revision> {
    try {
      return await this.#invoke<Revision>("saf_stat", { uri: path });
    } catch (e) {
      throw toStorageError(e);
    }
  }

  async write(path: string, content: string, expectedRev?: Revision): Promise<WriteResult> {
    try {
      // Pre-write conflict check: only when a baseline rev was supplied. A null
      // current rev means the file is gone — not a conflict, just a new write.
      if (expectedRev != null) {
        const current = await this.#invoke<Revision>("saf_stat", { uri: path });
        if (current !== null && current !== expectedRev) {
          throw new StorageError("conflict", `file changed on disk: ${path}`);
        }
      }
      await this.#invoke<void>("saf_write", { uri: path, content });
      const rev = await this.#invoke<Revision>("saf_stat", { uri: path });
      return { rev };
    } catch (e) {
      throw toStorageError(e);
    }
  }
}
