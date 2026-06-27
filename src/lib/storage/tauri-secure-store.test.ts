import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri IPC so this glue file stays in coverage (no silent gap) without
// a real Tauri runtime — same pattern as settings/tauri-backend.test.ts.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { TauriSecureStore } from "./tauri-secure-store";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const SERVICE = "com.zhaostephen.szmde";

describe("[REQ-SEC-1] TauriSecureStore — IPC mapping", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("get invokes secure_get with the namespaced service + key", async () => {
    mockInvoke.mockResolvedValue("token-blob");
    expect(await new TauriSecureStore().get("gdrive:me")).toBe("token-blob");
    expect(mockInvoke).toHaveBeenCalledWith("secure_get", { service: SERVICE, account: "gdrive:me" });
  });

  it("get returns null when the entry is absent", async () => {
    mockInvoke.mockResolvedValue(null);
    expect(await new TauriSecureStore().get("missing")).toBeNull();
  });

  it("set invokes secure_set with the value", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await new TauriSecureStore().set("k", "v");
    expect(mockInvoke).toHaveBeenCalledWith("secure_set", { service: SERVICE, account: "k", value: "v" });
  });

  it("delete invokes secure_delete", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await new TauriSecureStore().delete("k");
    expect(mockInvoke).toHaveBeenCalledWith("secure_delete", { service: SERVICE, account: "k" });
  });
});
