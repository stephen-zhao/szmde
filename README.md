# szmde — Stephen Zhao MarkDown Editor

A fast, cross-platform **WYSIWYG markdown editor** for local and cloud-stored files.
See [SPEC.md](SPEC.md) for the full specification.

**Stack:** CodeMirror 6 · Svelte 5 / SvelteKit (static) · Tauri 2 · TypeScript + Rust.

## Status

**Shipped: M0–M5.** The full WYSIWYG live-preview engine (three render modes, reveal-on-cursor
hidden markers, block widgets), the v1 GFM feature set (headings, lists, tables, task lists, images,
code, GFM alerts, horizontal rules, nested lists), EOL/indentation widgets, a two-tier settings
system, CI/CD, cloud storage (**Google Drive live**; OneDrive backend-only), authoring essentials
(find & replace, emoji shortcodes, foldable sections, word count, scroll-zoom / page-width), and
**rich inline table editing** — all on a `szmde` CLI launcher with single-instance forwarding and
local open/save (incl. WSL UNC paths on Windows).

Next up: M5 **S7** (toggle the table header row) and **M6 (Android)**. See
[docs/roadmap.md](docs/roadmap.md) for the authoritative status tracker and
[docs/m3-cloud-setup.md](docs/m3-cloud-setup.md) for cloud setup.

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
- **Android** — Tauri 2 mobile + Android SDK/NDK (planned; see [docs/roadmap.md](docs/roadmap.md)).
