import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  toStorageError,
  type Capabilities,
  type ReadResult,
  type StorageProvider,
  type WriteResult,
} from "./provider";

/** The Tauri IPC signature, narrowed to what this backend needs. Injected so the
 *  mapping is unit-testable with a fake; the default is the real Tauri `invoke`. */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * The desktop local-filesystem backend (SPEC §6): maps the StorageProvider seam
 * onto the Rust `read_file` / `write_file` Tauri commands (src-tauri/src/lib.rs),
 * which already handle Windows UNC / WSL paths (§6.1). EOL transform stays ABOVE
 * the provider (the shell), so this backend deals in the exact on-disk bytes.
 *
 * Revisions are not emitted yet (`rev: null`) → conflict detection is off; S2
 * (REQ-SAVE-1) adds an mtime-based revision and flips `conflictDetection` on.
 */
export class LocalProvider implements StorageProvider {
  readonly id = "local";
  readonly capabilities: Capabilities = {
    conflictDetection: false,
    list: false,
    watch: false,
  };

  #invoke: InvokeFn;
  constructor(invoke: InvokeFn = tauriInvoke) {
    this.#invoke = invoke;
  }

  async read(path: string): Promise<ReadResult> {
    try {
      const content = await this.#invoke<string>("read_file", { path });
      return { content, rev: null };
    } catch (e) {
      throw toStorageError(e);
    }
  }

  async write(path: string, content: string): Promise<WriteResult> {
    try {
      await this.#invoke<void>("write_file", { path, content });
      return { rev: null };
    } catch (e) {
      throw toStorageError(e);
    }
  }
}
