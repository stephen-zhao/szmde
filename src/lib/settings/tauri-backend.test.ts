import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri IPC so this plain-TS glue file stays in the coverage scope
// (no silent gap) without needing a real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { TauriSettingsBackend } from "./tauri-backend";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe("[REQ-SET-1] TauriSettingsBackend — IPC mapping", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("readUser invokes read_settings_file with which:user", async () => {
    mockInvoke.mockResolvedValue("{user}");
    const out = await new TauriSettingsBackend().readUser();
    expect(out).toBe("{user}");
    expect(mockInvoke).toHaveBeenCalledWith("read_settings_file", { which: "user" });
  });

  it("readSystem invokes read_settings_file with which:system", async () => {
    mockInvoke.mockResolvedValue(null); // absent file
    const out = await new TauriSettingsBackend().readSystem();
    expect(out).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("read_settings_file", { which: "system" });
  });

  it("writeUser invokes write_settings_file with the content", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await new TauriSettingsBackend().writeUser("{a:1}");
    expect(mockInvoke).toHaveBeenCalledWith("write_settings_file", { content: "{a:1}" });
  });
});
