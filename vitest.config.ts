import { defineConfig } from "vitest/config";

// Standalone test config (not the SvelteKit vite.config) — the editor logic is
// plain TS + CodeMirror, so we run it under happy-dom and construct real
// EditorViews to exercise the integrated keymap/decorations, not just commands
// in isolation.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
