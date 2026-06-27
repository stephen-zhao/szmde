import { describe, expect, it } from "vitest";
import * as layout from "./+layout";

// szmde ships as a Tauri app with no Node server, so the SvelteKit root layout
// must disable SSR (adapter-static SPA fallback). If `ssr` ever became true (or
// got dropped), the static build would try to server-render and break the Tauri
// frontend — this guards that contract.
describe("+layout.ts route config", () => {
  it("disables SSR (SPA mode for the static Tauri build)", () => {
    expect(layout.ssr).toBe(false);
  });
});
