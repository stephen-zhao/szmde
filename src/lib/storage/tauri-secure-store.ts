import { invoke } from "@tauri-apps/api/core";
import type { SecureStore } from "./secure-store";

/**
 * Desktop SecureStore backed by the OS credential store (Windows Credential
 * Manager / macOS Keychain / Linux Secret Service) via the Rust `secure_*`
 * commands (src-tauri/src/lib.rs, the `keyring` crate). All entries are namespaced
 * under one service so szmde's tokens are grouped and easy to clear.
 *
 * The ONLY storage file that imports Tauri IPC for secrets; kept in coverage via a
 * vi.mock test (no silent gap). The Rust keyring side is the integration tail
 * (cargo round-trip on a real OS store), like the other native commands.
 */
const SERVICE = "com.zhaostephen.szmde";

export class TauriSecureStore implements SecureStore {
  get(key: string): Promise<string | null> {
    return invoke<string | null>("secure_get", { service: SERVICE, account: key });
  }
  set(key: string, value: string): Promise<void> {
    return invoke<void>("secure_set", { service: SERVICE, account: key, value });
  }
  delete(key: string): Promise<void> {
    return invoke<void>("secure_delete", { service: SERVICE, account: key });
  }
}
