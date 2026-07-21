# szmde — project guide

**szmde** (Stephen Zhao MarkDown Editor) is a fast, canvas-first **WYSIWYG GFM markdown editor**:
a live-preview surface where headings render large, bullets render as bullets, and bold renders
bold — while the file on disk stays plain, portable CommonMark/GFM text. [SPEC.md](SPEC.md) is the
vision; [docs/roadmap.md](docs/roadmap.md) is the authoritative current-status tracker. Read those
two before making product decisions.

## Stack

CodeMirror 6 · Svelte 5 / SvelteKit (`adapter-static`) · Tauri 2 · TypeScript + Rust. Shipped
**Windows-native first** (WebView2); macOS/web share the frontend, **Android is in progress (M6)** —
`src-tauri/gen/android` is committed and all four ABIs cross-compile.

## Current state (2026-07-21)

- **Shipped & merged: M0–M5**, plus `REQ-CLOUD-3` (least-privilege Drive picker) and `REQ-SCROLL-1`
  (typewriter scrolling). Full live-preview engine (render modes, hidden markers, block widgets),
  the v1 GFM feature set, two-tier settings, CI/CD, cloud storage, authoring essentials
  (find/replace, emoji, folding, word count, zoom/page-width), and rich inline table editing.
- **In flight: M6 (Android).** S1 (cross-compile + `gen/android`), S2 (responsive shell) and S3
  (soft-keyboard/IME via a native inset bridge) are merged. **Next is S4** — the SAF storage backend
  (`REQ-MOBILE-3`); until it lands the Android app can only edit an unsaved buffer.
- **Deferred, not next:** OneDrive live wiring (`REQ-CLOUD-2`, deprioritized 2026-07-11 — backend +
  unit tests exist, no UI entry). See [docs/roadmap.md#whats-left](docs/roadmap.md) and
  [docs/m6-plan.md](docs/m6-plan.md).

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
  `WF-*`) — add a live workflow *before* fixing a live bug (TDD for interaction).
- **Bugs vs requirements:** [docs/bugs.md](docs/bugs.md) is behavior that violates an *existing* REQ;
  an under-specified gap becomes a *new* REQ in requirements.md. Each review round is triaged.
- **Substantial code changes** get the adversarial multi-agent ("ultracode") find→verify-by-refutation
  review before merge.
- **No hardcoded counts in prose docs.** Test counts, file counts, requirement/gap tallies and
  `WF-1…WF-n` ranges rot on the next commit and cost a doc edit every time. State the property and
  name the command that prints the number (`npm run test:trace`, `npm run test:coverage`,
  `cargo test`). Measurements with a device/date (`--kb-inset 373px on a Pixel 9 Pro`), enforced
  thresholds (100% lines) and config values (minSdk 24) are NOT counts — keep those.

## Storage seam (current reality)

- All I/O goes through the **`StorageProvider` seam** (`src/lib/storage/`); the on-disk artifact stays
  portable GFM for every backend.
- **Google Drive: LIVE, least-privilege.** Uses the **non-sensitive `drive.file` scope**; pre-existing
  files are opened via the **system-browser Google Picker** (`trigger_onepick`, REQ-CLOUD-3) — the pick
  grants per-file access AND doubles as sign-in (its code exchange persists tokens). Nothing
  Google-related loads in the WebView: **no CSP change, no authorized JS origin, no token in page JS**.
  Do NOT reintroduce the full `drive` scope (restricted → verification + unverified-app warning) or an
  in-WebView Picker. OAuth loopback + PKCE, `Host`-header allowlisted (DNS-rebinding defence); tokens in
  the Windows Credential Manager (`TauriSecureStore`). Setup: [docs/m3-cloud-setup.md](docs/m3-cloud-setup.md);
  design: [docs/gdrive-picker-plan.md](docs/gdrive-picker-plan.md). Open via **hamburger → Storage →
  Open from Google Drive…** (launches the Picker).
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
  edge is a 3-column `[fold chevron][marker gutter][content]` layout (`REQ-RENDER-12`). Those columns
  are becoming configurable **lanes** (`REQ-LANE-*`, M6.2) — read SPEC §7.6 before changing their
  widths.
- **Typewriter scrolling** (`REQ-SCROLL-1`): the active line never rests below a **two-thirds**
  anchor. It is an `EditorView.scrollHandler` that *never claims the scroll* — it schedules a
  measure-phase adjustment instead. Do NOT reimplement it with `scrollMargins` (that facet also
  drives paging, drag-select and tooltips) and never call `coordsAtPos` from the handler itself
  (it throws inside CodeMirror's update, and CodeMirror swallows it silently).

## Build & run

```sh
npm install
npm run tauri dev     # desktop app (hot-reloads the frontend)
npm run dev           # web frontend only (Vite, http://localhost:1420)
npm run check         # svelte-check
npm run test:coverage # vitest + 100%-lines gate
npm run test:trace    # requirement↔test audit
npm run tauri build   # Windows installer

# Android (M6) — needs JAVA_HOME + ANDROID_HOME + NDK; see docs/m6-plan.md
npx tauri android build --debug --apk --target aarch64   # debug APK
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
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
[docs/m6-plan.md](docs/m6-plan.md) (current milestone plan) ·
[docs/m3-cloud-setup.md](docs/m3-cloud-setup.md) (living ops guide) ·
[docs/archive/](docs/archive/) (historical milestone plans). Full map: [docs/INDEX.md](docs/INDEX.md).
