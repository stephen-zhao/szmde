# szmde — Specification (Draft v0.1)

_**szmde** = **S**tephen **Z**hao **M**ark**D**own **E**ditor._

_Status: draft for review. Date: 2026-06-24._

A minimal, fast, cross-platform **WYSIWYG markdown editor** for local and cloud-stored
files. "What you see is what you get" — headings render larger, bullets render as
bullets, bold renders bold — while the underlying file stays plain CommonMark/GFM
markdown text on disk.

This document fleshes out the requirements, recommends an architecture, and lists
orthogonal features to prioritize iteratively.

---

## 1. Product principles

1. **The file is plain markdown.** We never invent a proprietary format. What is saved
   to disk is portable GFM markdown that opens correctly in any other editor.
2. **Editing must feel instant.** No perceptible lag on keystroke, even in large
   documents. This is a hard constraint that drives the editor-engine choice (§4).
3. **Invisible UI.** A blank canvas. The only chrome is a hamburger menu, top-left.
4. **Unified look everywhere.** One design system, one editor engine, shared across
   Windows, macOS, Android, and web. Dark mode by default; light mode supported.
5. **Markers are first-class text.** In the two "show markers" modes, the markdown
   syntax characters (`**`, `#`, `>`, etc.) are real, selectable, navigable, editable
   text — not hidden decorations bolted onto a tree.

---

## 2. Target platforms

| Platform | Shipping form | Notes |
|----------|---------------|-------|
| Windows  | Native app (Tauri) | Single `.msi`/`.exe`. |
| macOS    | Native app (Tauri) | Universal binary (Apple Silicon + Intel). |
| Android  | Native app (Tauri 2 mobile) | APK / Play Store. |
| Web      | PWA | Installable; works offline; File System Access API. |
| _(iOS)_  | _Deferred_ | Tauri 2 supports it; out of initial scope unless requested. |

**Single codebase.** All four targets share one TypeScript frontend + editor engine.
Platform-specific code is isolated behind a thin native-bridge layer (filesystem,
OAuth redirect handling, share sheets).

### 2.1 CLI launcher (desktop, v1)

A small command-line entry point so a markdown file can be opened straight from a shell:

```
szmde [options] [file ...]
```

- `szmde notes.md` — open the file in szmde. Relative paths resolve against the shell's
  current working directory; `szmde` with no file opens a blank document.
- **PATH integration:** the desktop installer puts the `szmde` launcher on `PATH`
  (`szmde.exe` on Windows). It's a thin shim that forwards args to the app.
- **Single-instance by default:** if szmde is already running, the file opens in the
  existing instance (via Tauri's single-instance plugin) rather than spawning a second
  process. `--new-window` forces a new window.
- **Options (initial):** `--new-window`, `--render-mode <clean|markers-rendered|markers-syntax>`,
  `--version`, `--help`. Exit codes: `0` ok, non-zero on bad path/args.
- **WSL interop (Windows):** when `szmde.exe` is invoked from inside a WSL shell, the
  argument is a Linux path (e.g. `/home/me/x.md`). The launcher detects this and converts
  it to the `\\wsl.localhost\<distro>\…` UNC form (equivalent of `wslpath -w`) before
  handing it to the app. See §6.1.
- Non-goal for v1: a full headless/scripting CLI (convert, lint, export). This launcher
  only *opens* files in the GUI.

---

## 3. Technology stack

> **Confirmed (2026-06-25):** CodeMirror 6 + Svelte + Tauri 2. Rationale below;
> alternatives considered in §3.1.

| Layer | Recommendation | Why |
|-------|----------------|-----|
| **Editor engine** | **CodeMirror 6** + custom markdown live-preview extension | Text-first model: the raw markdown is always the document. Decorations hide/style/grey the markers. This is exactly what requirement 8 needs and is the proven approach behind Obsidian's Live Preview. Extremely fast (virtualized), zero-lag typing. |
| **UI shell / components** | **Svelte** (or Lit) | Tiny runtime, minimal overhead, fits the "barely any UI" goal. Keeps memory/CPU headroom for the editor. |
| **Desktop wrapper** | **Tauri 2** (Rust) | Small binaries (~3–10 MB vs Electron's ~100 MB+), native filesystem via Rust, low memory. One project targets Windows + macOS + Android. |
| **Android** | **Tauri 2 mobile** | Same frontend, same Rust bridge. No separate codebase. |
| **Web** | Same frontend as PWA | File System Access API for local files; OAuth for cloud. |
| **Markdown parsing** | CodeMirror's Lezer markdown grammar (live, in-editor) + `remark`/`micromark` for any out-of-editor parsing (export, validation) | Lezer is incremental → fast re-parse on every keystroke. |
| **Language** | TypeScript everywhere; Rust for the native bridge | |

### Why CodeMirror 6 over a rich-text engine (ProseMirror / TipTap / Lexical)

Requirement 8 is the deciding factor. ProseMirror-family editors model the document as a
**tree of nodes and marks** — the `**` characters of bold *do not exist* in the document;
"bold" is an attribute. Making the syntax markers appear as real, arrow-navigable,
deletable text (modes 2 and 3) fights that model and requires extensive custom work.

CodeMirror 6 models the document as **text** and layers _decorations_ on top:
- **Mode 1 (hide markers):** decorations `replace` the marker ranges with nothing.
- **Mode 2 (show, styled like rendered):** markers stay visible, styled the same as the
  text they format (a `**` inside bold is itself bold).
- **Mode 3 (show, small & greyed):** markers stay visible with a muted "syntax token" style.

In all modes the markers remain in the underlying text, so arrow keys, selection, and
deletion treat them as ordinary characters for free — which is precisely the spec. Block
rendering (heading sizes, bullets, callouts, code blocks, tables) is achieved with
CodeMirror decorations and block widgets.

### 3.1 Alternatives considered (for the record)

- **Electron + ProseMirror/TipTap** — heavier binaries, and the marker-as-text
  requirement is awkward (see above). Rejected primarily on requirement 8 and binary size.
- **Flutter** — one codebase for all platforms, but no mature WYSIWYG-markdown editor
  engine; we'd build the text engine from scratch and lose the web story's quality.
- **Lexical (Meta)** — fast and modern, but same tree-model mismatch with requirement 8.
- **Kotlin Multiplatform + Compose** — excellent native feel, but weak/no web target and
  no off-the-shelf markdown editor engine.

---

## 4. The editor: WYSIWYG live-preview

### 4.1 Render modes (requirement 8)

A global setting + quick-toggle with three states:

1. **Clean** — all markers hidden. Pure WYSIWYG.
2. **Markers (rendered style)** — markers shown, styled identically to the formatted text.
3. **Markers (syntax style)** — markers shown as small, greyed-out inline tokens.

Behavior common to modes 2 & 3:
- Markers are part of the text: selectable, copyable, arrow-key navigable.
- Editing/deleting a marker changes formatting (delete the closing `**` → text un-bolds).
- Typing a marker applies formatting live.

**Mode 1 uses reveal-on-cursor (decided).** When the cursor enters a construct, that
construct's markers become visible so you can edit them, then re-hide when the cursor
leaves — the standard live-preview affordance. (Markers are never made visible for
constructs the cursor isn't in.)

In Clean mode, unordered-list bullets and ordered-list numbers are **content, not syntax**,
so they render in normal text color (not greyed) — only the truly-syntactic markers are
hidden/greyed.

**Deferred refinement (markers-syntax layout — later):** in markers-syntax mode, block-level
leading markers should hang in the **left margin** (negative indent, to the left of the text
column) so the content stays flush at the left margin rather than being pushed inward. This
applies to:
- **heading markers** (`#`, `##`, …) — and the space following them likewise sits in the
  gutter, so heading text starts at the left margin;
- **blockquote markers** (`>`) — they too appear to the left of the left-margin line, keeping
  quoted text aligned at the margin.

Tracked as a deferred item in [docs/m1-plan.md](docs/m1-plan.md).

### 4.2 Markdown shortcuts drive formatting (requirement 8)

- Typing markdown syntax produces formatting immediately (`# ` → H1, `- ` → bullet,
  `> ` → blockquote, ``` ``` ``` → code block, `**x**` → bold, etc.).
- Keyboard shortcuts as accelerators: `Ctrl/Cmd+B` bold, `Ctrl/Cmd+I` italic, etc.
  (Underline is deferred — see §5.3 — so no `Ctrl/Cmd+U` binding in v1.)
- Input rules are reversible by editing the markers (consistent with §4.1).

### 4.3 Performance (requirement 7)

- Incremental Lezer parse — only the edited region re-parses.
- Viewport virtualization — only visible lines are rendered/decorated.
- Decoration computation debounced off the keystroke critical path where possible.
- **Acceptance target:** keystroke-to-paint < 16 ms (one frame) on a 10,000-line
  document on mid-range hardware (including Android).

### 4.4 Line endings & indentation (v1)

Both are per-document, editable via a small status widget (§7.1) and defaulted via settings.

**Line endings (EOL).**
- **Default `LF` on every platform, including Windows.** New documents use `LF`.
- On **open**, szmde detects the file's existing EOL (`LF` / `CRLF` / mixed) and the
  widget reflects it; the file is otherwise left as-is until edited/saved. A mixed-EOL
  file is reported as such and normalized to the active setting on first save.
- The widget toggles `LF ⇄ CRLF`. Since CodeMirror keeps the buffer as `LF` internally, EOL
  is **write-time metadata**: toggling chooses the line ending written on save and marks the
  document dirty (undo by re-toggling). The on-disk result is identical to rewriting every
  line ending, without churning the buffer/undo history.
- This supersedes the earlier "preserve EOL untouched" wording: szmde now *manages* EOL
  explicitly (default `LF`) rather than passively preserving it. The §6.1 WSL note is
  updated to match — `LF` is exactly what WSL files want anyway.

**Indentation.**
- **Default: the Tab key inserts spaces** (soft tabs), width **2** (`indentWidth`).
- The widget toggles **Spaces ⇄ Tab**, and when Spaces is active, sets the **width**
  (2 / 4 / custom) — mirroring VS Code's indentation control.
- Affects the Tab key, auto-indent, and list-continuation indentation. Backspace at the
  start of soft-tab indentation deletes a full indent level ("smart" outdent).
- Changing the setting affects subsequent edits; an explicit "convert existing indentation"
  action (spaces↔tabs across the file) is available from the widget menu.

---

## 5. Markdown feature coverage

**Baseline spec:** [GitHub Flavored Markdown](https://github.github.com/gfm/)
(CommonMark + GFM extensions). This is the "real spec" referenced in requirement 5.

### 5.1 In scope for v1 (must-have, from requirement 5)

| Feature | Markdown | WYSIWYG rendering |
|---------|----------|-------------------|
| Bold | `**x**` | **bold** |
| Italic | `*x*` / `_x_` | _italic_ |
| ~~Underline~~ | _deferred — see §5.3_ | not in v1 |
| Strikethrough | `~~x~~` | ~~strike~~ (GFM) |
| Headings H1–H6 | `#` … `######` | progressively larger headings |
| Blockquote | `> ` | indented quote bar |
| GFM alerts/callouts | `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` | styled callout boxes with icon |
| Unordered list | `- ` / `* ` / `+ ` | bullet points |
| Ordered list | `1. ` | numbered list |
| Code block (fenced) | ` ```lang ` | monospace block, optional syntax highlight |
| Inline code | `` `x` `` | monospace span |
| Links | `[text](url)`, autolinks | clickable link |
| Images | `![alt](src)` | rendered inline (local + remote; cloud-relative paths TBD) |
| Tables (GFM) | pipe tables | rendered as real tables |
| Task lists | `- [ ]` / `- [x]` | rendered as checkboxes |
| Horizontal rule | `---` | divider line |
| Nested lists | indentation | mixed ordered/unordered nesting |
| Paragraph / line breaks | — | — |

_(The above folds in the former "GFM core" set — links, images, tables, task lists,
horizontal rule, nested lists — at your request; all are v1 must-haves.)_

### 5.2 HTML handling (requirement 6)

- HTML blocks and inline HTML are **rendered as raw text** in a distinct style, with a
  small "HTML not rendered" affordance/badge.
- Architected behind an interface so a future "render HTML" mode can be slotted in
  without touching the core.
- Exception: a tiny allowlist (`<u>`, `<br>`, maybe `<sub>`/`<sup>`) _may_ be rendered to
  support features markdown lacks natively (see §5.3). To be decided.

### 5.3 Underline note

**Decision: underline is deferred out of v1.** CommonMark/GFM has no native underline
syntax, so there is no portable, spec-clean way to express it without either embedding
HTML (`<u>…</u>`) or inventing a custom syntax that breaks portability. Rather than ship a
compromise, we drop underline from v1 (bold / italic / strikethrough cover the baseline).

When revisited, the leading option is `<u>…</u>` via a small HTML render allowlist (tied
to the §5.2 / §8 `renderHtml` extension work). A custom `__x__` mapping is explicitly
rejected — it collides with CommonMark's strong/bold and corrupts portability.

### 5.4 Orthogonal / later features (post-v1, requirement 5)

> **Not required for v1.** These are independent of the core and will be prioritized
> later; ordering is deferred and does not block v1. Listed here only to capture scope.

Candidate features, in no particular order:

- Footnotes (`[^1]`)
- Definition lists
- Math / LaTeX (`$…$`, `$$…$$`) via KaTeX
- Mermaid / diagram code blocks
- Front-matter (YAML/TOML) editing
- Wiki-links `[[…]]` (Obsidian-style)
- Syntax highlighting inside fenced code blocks (per-language)
- Emoji shortcodes `:smile:`
- Table of contents generation
- Find & replace (incl. regex)
- Word/character count
- Spell check
- Export to HTML / PDF
- Collapsible/foldable sections and headings
- Comments / annotations
- Multi-document **tabs + splittable panes** with drag-and-drop layouting — see §7.2 (large,
  likely its own milestone; needs a workspace/layout-tree rearchitecture above the editor core)
- Best-in-class **table editing experience** (insert any dimension, toggle header row,
  insert/delete/reorder rows & columns from any position, cursor-context shortcuts,
  drag-to-reorder) — see §7.4
- **Alt-key shortcut hints** overlaid on chrome elements — see §7.5
- Outline / document map sidebar

_Prioritization to come later — not important for v1._

---

## 6. Storage & file access (requirement 2)

A single **StorageProvider** abstraction; each backend implements open/list/read/write/
save-as. The editor core never knows which backend it's talking to.

```
interface StorageProvider {
  id: string;                       // "local" | "gdrive" | "onedrive" | "network"
  listDir(path): Entry[];
  readFile(path): { content, etag };
  writeFile(path, content, etag?):  // etag → conflict detection
  watch?(path): events;             // optional live-change notifications
  capabilities: { watch, rename, mkdir, ... };
}
```

| Backend | Desktop (Tauri) | Android | Web |
|---------|-----------------|---------|-----|
| **Local filesystem** | Rust `std::fs` (incl. WSL UNC paths — see §6.1) | Storage Access Framework / scoped storage | File System Access API (Chromium); fallback to download/upload on others |
| **Google Drive** | OAuth + Drive REST API | same | same |
| **OneDrive** | OAuth + Microsoft Graph API | same | same |
| **Network storage** | **SMB/CIFS + WebDAV via Rust (both v1)** | WebDAV (raw SMB limited on Android) | WebDAV only (no raw SMB from browser) |

Cross-cutting concerns:
- **Conflict handling:** etag/mtime check on save; warn + offer merge/overwrite/save-copy.
- **Autosave + local draft cache** so a dropped network connection never loses work.
- **OAuth tokens** stored in the OS secure store (Keychain / Credential Manager /
  Android Keystore); refresh handled in the native layer.
- **Offline:** local cache of recently opened cloud files; queue writes until reconnect.

> **Decision:** both **SMB/CIFS and WebDAV ship in v1**. SMB is the lead use case
> (home/office NAS shares) and, with WebDAV, is implemented in the Rust bridge → both
> available on desktop. WebDAV is also what unlocks network storage on the web build,
> since browsers cannot reach raw SMB. Implication: desktop gets both protocols; the web
> build is WebDAV-only; Android is WebDAV-first (raw SMB support is limited there).

### 6.1 WSL filesystem access (Windows desktop, v1)

**Mostly already covered by the local-filesystem provider.** Windows exposes each running
WSL2 distro's root as a UNC network path — `\\wsl.localhost\<distro>\…` (modern) and the
legacy `\\wsl$\<distro>\…`. Rust `std::fs` reads and writes these like any other path, so
opening/saving a file under `\\wsl.localhost\Ubuntu-24.04\home\me\notes.md` works through
the existing provider with no separate backend.

What v1 must do deliberately to make it solid:
- **Accept & surface UNC roots** in the open/save dialogs (Windows native dialogs support
  `\\wsl.localhost\`); optionally enumerate installed distros for a quick-pick.
- **EOL & encoding** — WSL files are typically UTF-8 + `LF`, which is exactly szmde's
  default EOL (§4.4), so no special-casing is needed: szmde writes `LF` unless the user
  toggles the file to `CRLF`. Preserve the file's existing text encoding / BOM on save;
  don't silently change it.
- **Don't rewrite POSIX permissions/ownership** on save (use a read-modify-write that
  leaves mode bits alone where possible); be tolerant of symlinks.
- **Path translation for the CLI** — convert Linux paths to UNC when launched from a WSL
  shell (§2.1).

Caveats (documented, not blockers): access goes over the 9P protocol so it is slower than
native NTFS; the target distro must be running (Windows auto-starts it on first access);
and file-watching over the WSL share may be unreliable, so treat `watch` as best-effort.

---

## 7. UI / UX (requirements 3 & 9)

- **Canvas-first.** Open the app → a blank editable page, cursor ready. No toolbar, no
  status bar by default.
- **Only persistent chrome:** a **hamburger menu, top-left**. Contents:
  - New, Open, Recent
  - Save, Save As
  - Storage account connections (Google Drive, OneDrive, network)
  - Render-mode toggle (Clean / Markers-rendered / Markers-syntax) — also bound to a
    keyboard shortcut (default `Ctrl/Cmd+Shift+M`, cycles the three modes; rebindable)
  - Settings
  - Exit (desktop)
- **Optional ephemeral affordances:** a lightweight selection/format popover may appear on
  text selection (toggleable; off by default to honor the "blank canvas" ethos).
- **Design language:** modern, sleek, generous whitespace, a single accent color, a
  readable serif or humanist-sans body font (configurable). Dark mode is the default;
  light mode toggle. Theming via CSS custom properties so themes are swappable.
- **Responsive:** the same layout adapts from desktop windows to Android phone widths.
- **Accessibility:** full keyboard operability, screen-reader labels on the menu, honors
  OS reduced-motion and high-contrast where possible.

### 7.1 Status widgets (EOL & indentation)

A minimal, unobtrusive status area in the **bottom-right corner** holds small click-to-edit
widgets, VS Code-style:

- **EOL widget** — shows `LF` or `CRLF`; click to toggle (immediately rewrites the file's
  line endings, §4.4).
- **Indentation widget** — shows e.g. `Spaces: 2` or `Tab`; click for a small menu to switch
  Spaces ⇄ Tab and pick the width, plus a "convert existing indentation" action (§4.4).

Reconciling with requirement 9 (blank canvas, hamburger-only): these widgets are
deliberately tiny, low-contrast, and tucked in the corner — closer to the cursor-position
hint in a clean editor than to a full status bar. They are **shown by default** (they're
the only way to surface/toggle these per-file settings), but a settings flag
(`appearance.showStatusWidgets`) can hide them, in which case the same toggles remain
available from the hamburger menu. Other future status items (word count, cursor position)
would live here too, off by default.

### 7.2 Workspace: tabs & splittable panes (deferred — post-M1, likely a dedicated milestone)

szmde should let you work with **multiple files at once** in a flexible, splittable workspace
— the VS Code / JetBrains model:

- **Tabs.** Each open file is a tab. Multiple tabs live in a **tab group** (one visible
  document at a time per group, with a tab strip to switch). Close / reorder tabs.
- **Split panes.** A tab group can be **split** into two panes — **side-by-side** (vertical
  split) or **top/bottom** (horizontal split) — for simultaneous viewing/editing. Each
  resulting pane is itself a tab group that can be split again, so the layout is a
  **recursive tree** of splits (arbitrary nesting). Splitters are draggable to resize.
- **Drag-and-drop layouting.** Dragging a tab shows **drop hotzones** on the target pane —
  center (move into that group), and the four edges (left/right/top/bottom) to **create a new
  split** in that direction and drop the tab there. Dropping on the tab strip reorders/moves
  between groups. This is how all split layouts are created and rearranged.
- Empty panes collapse; the tree simplifies automatically when a pane is emptied.

**Architectural impact (the "rearchitecting"):** today the shell is single-document — one
`EditorView` and one open file in `+page.svelte`. This feature requires a **workspace model**
layered above the editor core:

- A **document/buffer registry**: each open file is a document with its own `EditorState`
  (buffer, undo history, dirty flag, EOL/indent, path), independent of how many panes show it.
- A **layout tree**: nodes are either a *split* (orientation + children + sizes) or a *leaf*
  tab-group (ordered list of document ids + active id). Serializable so a session can persist
  (ties into §8 settings/session state).
- A **pane/tab-group UI** that mounts a CodeMirror `EditorView` per visible leaf, plus the
  drag/drop + hotzone interaction and split/resize logic.
- The CM editor core (render modes, markers, etc.) is **per-document and reusable as-is** —
  the work is the surrounding workspace/layout layer, the hamburger "Exit/Save" wiring becoming
  per-tab/per-window, and unsaved-changes guards becoming per-document.

This is the natural home for an eventual multi-window story too. Deferred well beyond M1;
slot into the roadmap (§10) as its own milestone when prioritized.

### 7.3 Zoom & page width (scroll gestures)

Two modifier-scroll gestures over the editor adjust presentation live:

- **Ctrl/Cmd + scroll → zoom the base text size.** Increases/decreases the base paragraph
  font size (the `--editor-font-size` variable, §S2). Everything that derives from it scales
  proportionally — headings, the small syntax-marker size, code, etc. The **reading-column
  width and side margins stay constant** (in absolute terms): only the text grows/shrinks, so
  larger text simply wraps sooner within the same column.
- **Shift + scroll → change the page width / margins.** Adjusts the reading-column width
  (`.cm-content` max-width), i.e. how wide the text column is vs. the side margins. Wider
  column ⇄ narrower margins.

Both are bounded (sensible min/max), step in small increments, and map to the same underlying
appearance settings (`appearance.fontSize` and `appearance.lineWidth`, §8) so the chosen
zoom/width persists once the settings system lands (M2). Implementation is small — a wheel
handler on the editor scroller updating the two values — but it's **not yet built**; schedule
when convenient (it doesn't depend on other milestones).

### 7.4 Table editing experience (later)

Traditional markdown editors make tables miserable — hand-aligning pipes, counting columns,
rebuilding a row to move a cell. szmde should make table editing genuinely pleasant: a
first-class **structured-editing** experience over what is still, on disk, portable **GFM
pipe tables**. Requirements:

- **Insert from scratch at any dimension.** A fast way to drop in an _N×M_ table — e.g. a
  drag-to-size grid picker or a command ("Insert table 3×4") — not a hand-typed skeleton.
- **Toggle the header row** on/off for an existing table.
- **Insert / delete rows and columns at any position** — before, after, or _between_ existing
  ones, relative to wherever the cursor is, not just at the table edges.
- **Drag to reorder** columns and rows (grab a column/row handle and drop it elsewhere).
- **Cursor-context shortcuts** for every structural action, keyed off the cell the caret sits in:
  - move current column left / right; move current row up / down;
  - insert column before / after the current column; insert row above / below;
  - delete current row / column.
  (Exact keybindings TBD; must not collide with text editing or the §4.2 formatting keys.)
- **Auto-tidy source.** Cells re-pad/realign as you edit so the saved GFM stays clean; per-column
  alignment (`:--`, `:-:`, `--:`) is settable from the editing UI.

Scope note: GFM table _rendering_ is M2 (§5.1). This rich _editing_ experience is a larger,
later effort — block-widget interaction work in the §9 decoration/widget layer — and is **not
required for v1**.

### 7.5 Keyboard-shortcut hints (Alt overlay) (later)

Holding **Alt** reveals keyboard-shortcut hint badges over the chrome elements that have
accelerators — the hamburger menu and its items, the §7.1 status-bar chips, and any future
toolbar affordances — in the spirit of classic desktop Alt-mnemonics. Releasing Alt hides them.
This keeps the canvas clean by default (§7, "canvas-first") while making shortcuts discoverable
on demand. Post-v1.

---

## 8. Settings & preferences (requirement 10)

Two-tier JSON, with user overriding system:

```
effective = deepMerge(systemSettings, userSettings)
```

- **System settings** (`system.json`) — defaults shipped with the app / set by an admin;
  read-only to the normal user.
- **User settings** (`user.json`) — per-user overrides; what the Settings UI writes.

Locations (per platform conventions):
- Desktop: OS config dir (e.g. `%APPDATA%\szmde\`, `~/Library/Application Support/szmde/`).
- Android: app-private storage.
- Web: a settings file in a chosen storage provider, with `localStorage`/IndexedDB cache.

Illustrative schema:

```jsonc
{
  "appearance": {
    "theme": "dark",            // "dark" | "light" | "system"
    "accentColor": "#7c9cff",
    "fontFamily": "Inter",
    "fontSize": 16,
    "lineWidth": "narrow",      // reading-width constraint
    "showStatusWidgets": true   // bottom-right EOL/indent widgets (§7.1)
  },
  "editor": {
    "renderMode": "clean",      // "clean" | "markers-rendered" | "markers-syntax"
    "revealMarkersOnCursor": true,
    "autosave": true,
    "autosaveIntervalMs": 2000,
    "spellcheck": false,
    "defaultEol": "lf",         // "lf" | "crlf" — default new docs; LF on all platforms (§4.4)
    "indentStyle": "spaces",    // "spaces" | "tab" (§4.4)
    "indentWidth": 2            // spaces per indent level; also the tab render width
  },
  "markdown": {
    "flavor": "gfm",
    "renderHtml": false         // future extension hook (requirement 6)
  },
  "storage": {
    "defaultProvider": "local",
    "accounts": [ /* connected cloud accounts (no secrets here) */ ]
  }
}
```

- Settings are validated against a JSON Schema on load; invalid keys fall back to defaults.
- Schema versioned with a migration step for forward compatibility.

---

## 9. Proposed architecture (layers)

```
┌─────────────────────────────────────────────────────────┐
│  UI shell (Svelte)  — hamburger menu, settings, dialogs  │
├─────────────────────────────────────────────────────────┤
│  Editor engine (CodeMirror 6 + markdown live-preview ext)│
│    · decorations for render modes 1/2/3                  │
│    · input rules / shortcuts                              │
│    · block widgets (tables, callouts, code, images)      │
├─────────────────────────────────────────────────────────┤
│  Core services (TS, platform-agnostic)                   │
│    · StorageProvider interface + backends                │
│    · Settings (system+user merge, schema, migration)     │
│    · Document/session state, autosave, conflict logic    │
├─────────────────────────────────────────────────────────┤
│  Native bridge                                           │
│    Tauri (Rust): fs, secure token store, SMB/WebDAV,     │
│      OS dialogs, share sheet                             │
│    Web: File System Access API, OAuth redirect, IndexedDB│
└─────────────────────────────────────────────────────────┘
```

Everything above the bridge is shared, untouched per platform. Each platform implements
the bridge interface only.

> **Future workspace layer (§7.2).** The tabs + splittable-pane workspace adds a layer
> between the UI shell and the editor engine: a document/buffer registry and a serializable
> layout tree, with one CodeMirror `EditorView` mounted per visible pane. The editor engine
> stays per-document and reusable; this is shell/layout work, not editor-core work.

---

## 10. Suggested milestones

> Per-milestone **implementation plans** (architecture + staged `S<n>` build slices) live
> under [`docs/`](docs/) — e.g. [docs/m1-plan.md](docs/m1-plan.md) for M1. This section is
> the high-level roadmap; the docs are the build breakdown.

1. **M0 – Skeleton:** Tauri + Svelte + CodeMirror 6 booting on Windows/macOS/web; blank
   canvas; hamburger menu; local file open/save (incl. WSL UNC paths on Windows, §6.1);
   `szmde` CLI launcher with single-instance forwarding (§2.1); dark theme.
2. **M1 – Core WYSIWYG (v1 inline + basic blocks):** render modes 1–3; markdown shortcuts;
   bold/italic/strikethrough, headings, blockquote, lists, code blocks, inline code, links;
   EOL + indentation behavior and the bottom-right status widgets (§4.4, §7.1);
   performance target met.
3. **Testing gate (after M1, before M2):** establish the quality bar per
   [docs/testing-strategy.md](docs/testing-strategy.md) — 100% unit coverage (ratcheted),
   integration tests for critical building-block combinations, and an auditable
   requirement→test traceability matrix. TDD ongoing throughout.
4. **M2 – Remaining v1 blocks + settings:** tables, task lists, images, horizontal rule,
   nested lists, GFM alerts/callouts; settings system (system+user JSON). _(Completes the
   full §5.1 v1 feature set.)_
4. **M3 – Cloud storage:** Google Drive + OneDrive; conflict/autosave/offline cache.
5. **M4 – Android:** Tauri mobile build; responsive UI; storage access framework.
6. **M5 – Network storage + polish:** SMB/CIFS + WebDAV on desktop (WebDAV also for
   web/Android); light mode; a11y pass; prioritized orthogonal features from §5.4.

---

## 11. Open questions for you

**Resolved so far:** app name — **szmde** (Stephen Zhao MarkDown Editor) · bundle ID
`com.zhaostephen.szmde` · stack confirmed — CodeMirror 6 + Svelte + Tauri 2 (§3) ·
underline deferred from v1 (§5.3) · network storage ships **both SMB/CIFS and WebDAV** in
v1 (§6) · mode-1 = **reveal-on-cursor** (§4.1) · render-mode toggle is in the menu **and**
bound to `Ctrl/Cmd+Shift+M` (§7).

**Deferred (non-blocking):** prioritization of the §5.4 post-v1 orthogonal features — to
be ranked later; not needed for v1.

No open questions block starting v1.
```
