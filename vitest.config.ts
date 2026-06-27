import { defineConfig } from "vitest/config";

// Standalone test config (not the SvelteKit vite.config) — the editor logic is
// plain TS + CodeMirror, so we run it under happy-dom and construct real
// EditorViews to exercise the integrated keymap/decorations, not just commands
// in isolation.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "html", "json-summary"],
      // Unit-coverage scope = the plain-TS logic modules. EXPLICIT exclusions
      // (T1 "no silent gaps"):
      //  - *.test.ts: the tests themselves.
      //  - *.svelte UI components (Editor/+page/HamburgerMenu): glue over the
      //    editor core; their behavior is exercised by integration/E2E, deferred.
      //    Not unit-tested here — tracked, not silently dropped.
      //  - *.svelte.ts: Svelte-5 runes glue (e.g. settings/store.svelte.ts);
      //    needs the Svelte compiler/runes runtime, which this plain-vitest setup
      //    lacks. Same boundary as .svelte — the tested logic lives in the pure
      //    service/core it delegates to.
      //  - src-tauri (Rust): covered separately by `cargo test` (+ llvm-cov).
      //  - generated/build output and type-only declarations.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.svelte.ts",
        "src/**/*.d.ts",
        "src/**/*.config.*",
      ],
      all: true,
      // Ratchet floors (T1). LINES are held at 100% — every executable line is
      // covered. Statements/functions/branches sit just under 100%: the residual
      // is defensive `state.field(_, false)` guards, single-line-fence edges, and
      // CodeMirror widget-diff plumbing that only the real WebView exercises (the
      // genuinely-unreachable bits carry explicit `/* v8 ignore */` with reasons).
      // We hold an honest floor rather than chase 100% with contrived tests.
      thresholds: {
        lines: 100,
        statements: 98,
        functions: 98,
        branches: 93,
      },
    },
  },
});
