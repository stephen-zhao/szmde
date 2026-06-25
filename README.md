# szmde — Stephen Zhao MarkDown Editor

A fast, cross-platform **WYSIWYG markdown editor** for local and cloud-stored files.
See [SPEC.md](SPEC.md) for the full specification.

**Stack:** CodeMirror 6 · Svelte 5 / SvelteKit (static) · Tauri 2 · TypeScript + Rust.

## Status

**M0 — Skeleton.** Tauri + Svelte + CodeMirror 6 booting to a blank dark canvas with a
hamburger menu, local file open/save (incl. WSL UNC paths on Windows), and a `szmde` CLI
launcher with single-instance forwarding. The WYSIWYG live-preview engine (render modes,
hidden markers, block widgets) and EOL/indentation widgets arrive in M1.

## Development

This project is built **Windows-native** (Tauri can't cross-compile a Windows desktop
binary from WSL). Prerequisites: Node, Rust (MSVC toolchain), and the WebView2 runtime
(present on Windows 10/11 by default).

```sh
npm install
npm run tauri dev     # run the desktop app (hot-reloads the frontend)
npm run dev           # run only the web frontend (Vite, http://localhost:1420)
npm run check         # svelte-check type checking
npm run tauri build   # build a Windows installer
```

Open a file from the command line (after a build / while installed):

```sh
szmde path/to/notes.md
```

### Per-platform builds

Tauri does not cross-compile between desktop OSes:

- **Windows / Web** — built locally on Windows.
- **macOS** — built on macOS (a Mac or a `macos-latest` GitHub Actions runner via
  `tauri-action`); cannot be produced from Windows/WSL.
- **Android** — Tauri 2 mobile + Android SDK/NDK (milestone M4).
