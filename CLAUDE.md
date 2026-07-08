# szmde — project guide

**szmde** (Stephen Zhao MarkDown Editor) is a fast, canvas-first **WYSIWYG GFM markdown editor**:
a live-preview surface where headings render large, bullets render as bullets, and bold renders
bold — while the file on disk stays plain, portable CommonMark/GFM text. [SPEC.md](SPEC.md) is the
vision; [docs/roadmap.md](docs/roadmap.md) is the authoritative current-status tracker. Read those
two before making product decisions.

## Stack

CodeMirror 6 · Svelte 5 / SvelteKit (`adapter-static`) · Tauri 2 · TypeScript + Rust. Shipped
**Windows-native first** (WebView2); macOS/web share the frontend, Android (M6) is planned.

## Current state (2026-07-07)

- **Shipped & merged: M0–M5.** Full live-preview engine (render modes, hidden markers, block
  widgets), the v1 GFM feature set, two-tier settings, CI/CD, cloud storage, authoring essentials
  (find/replace, emoji, folding, word count, zoom/page-width), and rich inline table editing.
- **In flight / next:** OneDrive live wiring (`REQ-CLOUD-2`), then **M6 (Android)**. M5 is complete
  (the S7 header toggle shipped). See [docs/roadmap.md#whats-left](docs/roadmap.md).

## Process — no ad-hoc work (non-negotiable)

- **Every unit of work maps to a `REQ-*` id** ([docs/requirements.md](docs/requirements.md)) **and a
  SPEC section.** New behavior ⇒ catalogue a `REQ` first; new scope ⇒ add it to SPEC + roadmap first.
  Nothing beyond a trivial fix starts without a spec + milestone + requirement.
- **Strict TDD**, then **100%-lines coverage** (ratcheted, `vitest`). No silent caps — every coverage
  exclusion is explicit and reviewed; genuinely-unreachable lines carry `/* v8 ignore */` + a reason.
- **Requirement↔test traceability:** tests tag their `[REQ-*]` in the `describe()` title;
  `npm run test:trace` (`scripts/check-traceability.mjs`) audits that every catalogued requirement has
  a tagged test (or a tracked gap). CI-enforced ([docs/ci-cd.md](docs/ci-cd.md)).
- **Live/interaction behavior** that happy-dom can't express (layout, clicks, caret, visuals) is
  covered by the LLM-driven workflow suite ([docs/llm-workflow-tests.md](docs/llm-workflow-tests.md),
  `WF-1…WF-26`) — add a live workflow *before* fixing a live bug (TDD for interaction).
- **Bugs vs requirements:** [docs/bugs.md](docs/bugs.md) is behavior that violates an *existing* REQ;
  an under-specified gap becomes a *new* REQ in requirements.md. Each review round is triaged.
- **Substantial code changes** get the adversarial multi-agent ("ultracode") find→verify-by-refutation
  review before merge.

## Storage seam (current reality)

- All I/O goes through the **`StorageProvider` seam** (`src/lib/storage/`); the on-disk artifact stays
  portable GFM for every backend.
- **Google Drive: LIVE.** Uses the **full `https://www.googleapis.com/auth/drive` scope** — *not*
  `drive.file`, which only sees app-created files and 404s on a user's pre-existing file (the Google
  Picker, which would preserve least-privilege, is infeasible in a bundled Tauri WebView because its
  origin check rejects the custom-scheme origin). OAuth loopback + PKCE; tokens in the Windows
  Credential Manager (`TauriSecureStore`). Setup: [docs/m3-cloud-setup.md](docs/m3-cloud-setup.md).
  Connect via **hamburger → Storage → Connect Google Drive…**, open via **Open from Google Drive…**.
- **OneDrive: BACKEND-ONLY** (`onedrive.ts` + unit tests). No `onedrive-connect.ts`, no UI entry, no
  live wiring — do **not** describe it as usable until that lands.

## Editor conventions

- **Three render modes:** Formatted / Source / Syntax (internal ids `clean` / `markers-rendered` /
  `markers-syntax` in `render-mode.ts`). Markers are **real text** — never pushed into margins;
  hidden markers reveal-on-cursor in Formatted mode.
- Chars that **are the widget** (e.g. a task's `[ ]`) are content, not "just syntax" — never
  small-grey them in Syntax mode.
- **Tables:** a rendered table is **atomic** (arrows skip past it). Click a cell → an inline
  `<textarea>` over that cell's markdown source; Enter/Tab commit + move, Esc cancels, blur commits.
  Raw pipes appear in **Source mode only**. Do **not** reintroduce the old reveal-to-pipes /
  arrows-enter-table model.
- **Layout discipline:** padding/border, never margin; keep the symmetric centered column; the left
  edge is a 3-column `[fold chevron][marker gutter][content]` layout (`REQ-RENDER-12`).

## Build & run

```sh
npm install
npm run tauri dev     # desktop app (hot-reloads the frontend)
npm run dev           # web frontend only (Vite, http://localhost:1420)
npm run check         # svelte-check
npm run test:coverage # vitest + 100%-lines gate
npm run test:trace    # requirement↔test audit
npm run tauri build   # Windows installer
```

- **HMR can go stale** after many edits — hard-restart the dev app before trusting visual behavior.
- **Visual debugging:** load the Vite server (`localhost:1420`) in a browser preview and drive
  CodeMirror via the DEV-only `window.__cmview` handle (`Editor.svelte`); the `window.__T` helpers
  live in [docs/llm-workflow-tests.md](docs/llm-workflow-tests.md).
- **Shell note:** general tooling work here is WSL-first, but **szmde is developed Windows-native**
  (a documented exception — Tauri can't cross-compile the Windows/WebView2 target from WSL).

## Docs map

[SPEC.md](SPEC.md) (vision) · [docs/roadmap.md](docs/roadmap.md) (authoritative tracker) ·
[docs/requirements.md](docs/requirements.md) + [docs/bugs.md](docs/bugs.md) (live registries) ·
[docs/testing-strategy.md](docs/testing-strategy.md) · [docs/ci-cd.md](docs/ci-cd.md) ·
[docs/llm-workflow-tests.md](docs/llm-workflow-tests.md) ·
[docs/m3-cloud-setup.md](docs/m3-cloud-setup.md) (living ops guide) ·
[docs/archive/](docs/archive/) (historical milestone plans). Full map: [docs/INDEX.md](docs/INDEX.md).
