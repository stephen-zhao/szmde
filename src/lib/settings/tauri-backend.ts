import { invoke } from "@tauri-apps/api/core";
import type { SettingsBackend } from "./backend";

/**
 * The desktop backend: maps the SettingsBackend seam onto the Rust Tauri
 * commands (src-tauri/src/lib.rs). The ONLY file in the settings subsystem that
 * imports Tauri; kept in coverage via a vi.mock test (no silent gap).
 */
export class TauriSettingsBackend implements SettingsBackend {
  readSystem(): Promise<string | null> {
    return invoke<string | null>("read_settings_file", { which: "system" });
  }
  readUser(): Promise<string | null> {
    return invoke<string | null>("read_settings_file", { which: "user" });
  }
  writeUser(text: string): Promise<void> {
    return invoke<void>("write_settings_file", { content: text });
  }
}
