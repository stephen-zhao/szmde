# M2 — Remaining v1 blocks + settings (implementation plan)

_Implementation plan for milestone **M2** (see [SPEC.md](../SPEC.md) §10 "M2" for the
milestone definition and §5.1 / §8 for the behavior). SPEC.md is the "what"; this doc is
the "how" — the architecture and the staged `S1…S7` build slices. Same shape as
[m1-plan.md](m1-plan.md)._

_Status legend: ✅ done · 🔜 next · ⬜ planned._

## Scope (from SPEC §5.1 / §8 / §10 "M2")

Completes the full §5.1 v1 feature set plus the settings system:

1. **Horizontal rule** (`---` / `***` / `___`) → a divider. (S1)
2. **Task lists** (`- [ ]` / `- [x]`) → real checkboxes, click-to-toggle. (S2)
3. **Images** (`![alt](src)`) → rendered inline (local + remote). (S3)
4. **GFM alerts / callouts** (`> [!NOTE]` … `[!CAUTION]`) → styled callout boxes with icon. (S4)
5. **Tables** (GFM pipe tables) → rendered as real tables (rich _editing_ is §7.4, deferred). (S5)
6. **Nested lists** — verify + polish (grammar already nests; M1 hang-indent handles it). (S6)
7. **Settings system** — two-tier (system + user) JSON, deep-merge, schema/defaults,
   migration; persist the existing per-window prefs (render mode, indent, EOL, appearance). (S7)

Out of scope (explicitly): the rich table-editing UX (§7.4), Alt-key hints (§7.5),
tabs/panes (§7.2), zoom/page-width gestures (§7.3), cloud/network storage (M3+).

## Grammar ground truth (probed against the configured parser)

The configured parser is `markdown({ base: markdownLanguage, extensions: [GFM, Frontmatter] })`.
Decorations **must** key on these real node names (verified 2026-06-27 by parsing samples):

| Construct | Tree shape |
|-----------|-----------|
| Horizontal rule | `HorizontalRule` (single line; the `---`/`***`/`___` run) |
| Task list item | `ListItem > ListMark` (`-`) **and** `Task > TaskMarker` (`[ ]` / `[x]`); the rest of the item text follows `TaskMarker` inside `Task` |
| Image (inline) | `Image > LinkMark("![") · <alt text> · LinkMark("]") · LinkMark("(") · URL · LinkMark(")")` |
| Image (reference) | `Image > LinkMark("![") · <alt> · LinkMark("]") · LinkLabel("[id]")`; the `[id]: url` def is a sibling `LinkReference > LinkLabel · LinkMark(":") · URL` |
| Table | `Table > TableHeader > (TableDelimiter \| TableCell)` , then one `TableDelimiter` for the **whole separator row** (encodes alignment `:--`/`:-:`/`--:`), then `TableRow > (TableDelimiter \| TableCell)` per body row |
| GFM alert | **No dedicated node.** `> [!NOTE]` is a plain `Blockquote` whose first `Paragraph` opens with a `Link` `[!NOTE]`. Detect via regex on the blockquote's first content line. |
| Nested list | recursive `BulletList/OrderedList > ListItem > … > BulletList > …` (already correct) |

**Consequence for alerts (S4):** there is no `Callout`/`Alert` node to match. We detect a
blockquote-as-alert in the decoration plugin (first line matches
`/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i`), keeping the on-disk text plain GFM.

## Architecture (extends the M1 decoration layering)

M1 established three decoration producers; M2 slots into them rather than adding new
top-level concepts:

- **`markers.ts` (`markerDecorations`, `Prec.highest`)** — inline marker hide/style + the
  Clean-mode reveal-on-cursor + `atomicRanges`. M2's **inline / replace-with-widget**
  constructs live here or in a sibling plugin built the same way: **images** (replace the
  `Image` node with an `<img>` widget in Clean, reveal source on cursor — exactly the
  pattern the marker reveal already uses), **task checkboxes** (replace `TaskMarker` with a
  checkbox widget), **horizontal rules** (replace the `HorizontalRule` run with a divider
  widget in Clean; grey/style in marker modes).
- **`blocks.ts` (`blockConstructDecorations`)** — per-line block classes (heading spacing,
  quote bar). M2 adds **alert** line classes here (callout box + per-type accent) and the
  alert icon/label widget; the per-line Map approach already composes nested blocks.
- **`setup.ts` block-widget/line-deco layer** — the home for **tables**: a `BlockWrapper`
  or block `Decoration.replace` widget that renders a real `<table>` from the parsed cells
  in Clean mode, with **reveal-to-source on cursor** (consistent with code blocks / images;
  the rich in-place table editing is the separate §7.4 effort).

Shared M2 mechanics, reused from M1:
- **Reveal-on-cursor**: the Clean-mode "don't hide/replace the construct the caret is in"
  rule (markers.ts already computes `caretLines`/`caretPos`). Images, HR, and tables reuse
  it so a click into the construct shows the raw markdown for editing.
- **`atomicRanges`**: every Clean-mode `replace` range (image, checkbox region, HR, table)
  is also fed to the hidden RangeSet so arrows skip it and one delete removes the unit.
- **Render-mode awareness**: Clean = rendered widget; Source/Syntax = literal text (styled).
  Every M2 construct honors the three modes.
- **Viewport-only iteration** + the `syntaxTree`-changed rebuild guard (perf, SPEC §4.3).

### Settings architecture (S7) — the one genuinely new subsystem

Two-tier JSON, `effective = deepMerge(system, user)` (SPEC §8). Layers:

- **`src/lib/settings/schema.ts`** — the typed default settings object (the illustrative
  schema in SPEC §8) + a `SCHEMA_VERSION`, plus a validator that drops unknown/invalid keys
  back to defaults (hand-rolled, dependency-free, deterministic → unit-testable).
- **`src/lib/settings/merge.ts`** — `deepMerge` (objects merge, scalars/arrays replace) and
  `migrate(raw)` (version-stamped forward migration).
- **`src/lib/settings/store.ts`** — a platform-agnostic `SettingsService`: loads system +
  user, merges, exposes `get()` / `update(patch)` (writes user.json) and change
  notifications. Talks to a `SettingsBackend` interface so it's testable with an in-memory
  backend and pluggable per platform.
- **Native backend (Tauri)** — Rust commands `read_settings`/`write_settings` over the OS
  config dir (`%APPDATA%\szmde\`, `~/Library/Application Support/szmde/`, XDG). `system.json`
  read-only; `user.json` written atomically (reuse the M1 atomic-write helper).
- **Web backend** — `localStorage`/IndexedDB (deferred wiring; interface in place).
- **Wiring**: seed the editor's initial render mode / indent / EOL / appearance
  (`fontSize`, `lineWidth`, theme/accent/font CSS vars) from effective settings on boot;
  the status-bar toggles call `update()` so choices persist (replaces M1's "ephemeral per
  window" note). This also lands the persistence half of §7.3 zoom/width for later.

A focused **design judge-panel workflow** will precede S7 to settle file layout / validation
strategy / migration shape before building (the design space is wide; the editor slices are
not). The editor slices (S1–S6) are sequential, stateful decoration work — built directly,
TDD, one commit each.

## Staged build sequence

> Each slice: **failing test(s) first** (TDD, T4), then implementation, then `npm run test`
> + `npm run check` green, update [traceability.md](traceability.md) with the new `REQ-*`
> IDs and tag the tests, then commit. Visual-verify checkpoint with the user between slices.

### S1 — Horizontal rule ✅  (`REQ-HR-1`)
`HorizontalRule` node. Clean: replace the `---`/`***`/`___` run with a divider widget
(atomic + reveal-on-cursor). Syntax: grey the chars. Source: style as a rule + keep chars.
**Tests** (`hr.dom.test.ts`): divider widget present in Clean; literal chars in Source/Syntax;
caret on the line reveals the chars; arrow skips / single-delete removes it (atomic).

### S2 — Task lists ✅  (`REQ-TASK-1`, `REQ-TASK-2`)
`Task > TaskMarker`. Clean: replace `TaskMarker` (`[ ]`/`[x]`) with a checkbox widget;
click toggles the on-disk char (`[ ]`⇄`[x]`) via dispatch; checked state reflects `x`.
Keep the `- ` list bullet behavior. Source/Syntax: literal `[ ]`/`[x]` (styled).
**Tests** (`tasklist.dom.test.ts`): checkbox rendered + checked state in Clean; click
dispatches the exact text change; literal in Source; nested task items.

### S3 — Images ✅  (`REQ-IMG-1`, `REQ-IMG-2`)
`Image` node. Clean: replace the node with an `<img>` widget (atomic + reveal-on-cursor);
`alt` → `alt`/`title`; **src resolution** behind a `resolveImageSrc(src)` hook — remote
`http(s)`/`data:` pass through; local/relative resolved via an injected resolver (Tauri
`convertFileSrc` later; identity in tests / web for now). Broken/loading → alt fallback.
Source/Syntax: literal markdown (styled). Reference-style images render too (`LinkLabel`).
**Tests** (`image.dom.test.ts`): `<img>` with src+alt in Clean; literal in Source;
reveal-on-cursor; remote vs local resolution via the hook; reference-style resolves.
_Editor capability done + tested (the `imageResolver` facet). **Deferred follow-up:**
wiring Tauri `convertFileSrc` + the `tauri.conf.json` asset-protocol scope + resolving
relative paths against the open file's dir, so local desktop images load (remote/`data:`
render today). Lands with the S7 app-integration / settings pass._

### S4 — GFM alerts / callouts ✅  (`REQ-ALERT-1`, `REQ-ALERT-2`)
Detect a `Blockquote` whose first content line is `[!TYPE]` (5 types). Add
`cm-alert cm-alert-<type>` line classes + an icon/label widget; hide/style the `[!TYPE]`
token in Clean. Non-alert blockquotes keep the M1 single bar. 5 accent colors + icons.
**Tests** (`alerts.dom.test.ts`): each type gets its class + icon; `[!TYPE]` hidden in Clean,
literal in Source; a normal blockquote is unaffected; case-insensitive type match.

### S5 — Tables ✅  (`REQ-TABLE-1`, `REQ-TABLE-2`)
`Table`/`TableHeader`/`TableRow`/`TableCell`/`TableDelimiter`. Clean: a block widget renders
a real `<table>` (`<thead>` from `TableHeader`, `<tbody>` from rows, per-column alignment
parsed from the separator `TableDelimiter`), with **reveal-to-source on cursor** for editing.
Source/Syntax: keep pipe text (optionally monospace-aligned). Rich structured editing is
**§7.4, deferred** — this slice is rendering only; note that explicitly.
**Tests** (`table.dom.test.ts`): `<table>` with header + body cells + alignment classes in
Clean; reveal-to-source on cursor; literal in Source; ragged/incomplete tables don't crash.

### S6 — Nested lists polish ✅  (`REQ-NEST-1`)
Grammar already nests; M1 hang-indent/continuation handle it. Verify mixed ordered/unordered
nesting renders correctly and (optional) vary the bullet glyph by depth (•/◦/▪), Clean only.
**Tests** (`nested.dom.test.ts`): mixed nesting depth renders the right bullets/numbers; deep
nesting hang-indents align; Enter/Tab nesting from M1 still holds at depth.

### S7 — Settings system 🔜  (`REQ-SET-1`, `REQ-SET-2`, `REQ-SET-3`)
Preceded by a design judge-panel workflow (file layout / validation / migration). Then:
schema + defaults + version; `deepMerge`; `migrate`; `SettingsService` over a
`SettingsBackend`; Tauri Rust `read_settings`/`write_settings` (atomic user.json, read-only
system.json) in the OS config dir; seed editor render-mode/indent/EOL/appearance from
effective settings on boot; status-bar toggles persist via `update()`.
**Tests**: `merge.test.ts` (deepMerge precedence, arrays replace), `schema.test.ts`
(validation drops bad keys → defaults), migration (version bump), `store.test.ts`
(`SettingsService` over an in-memory backend: load→merge→update→persist→notify), Rust
config read/write roundtrip (`src-tauri/src/lib.rs`).

#### S7 chosen design (from the judge-panel design workflow, 2026-06-27)

Panel converged on **pure deterministic core + a string-I/O `SettingsBackend` seam + a thin
(coverage-excluded) Svelte runes adapter**. Sub-slices, each TDD + committed:

- **S7a — pure core** (`src/lib/settings/`): `schema.ts` (`Settings` types + `DEFAULTS`
  matching app.css: theme `dark`, accent `#7c9cff`, font `Inter`, size `16`, `lineWidth:
  "medium"`→740px, `defaultEol: lf`, `indentStyle: spaces`, `indentWidth: 2`, `renderMode:
  clean`; `autosave: false` — honest, not yet wired — divergence from §8's illustrative
  `true` noted) + `SCHEMA_VERSION` + per-field validators (reuse `RenderMode`/`IndentConfig`/
  `Eol` unions); `merge.ts` (`deepMerge`, **prototype-pollution-safe** — skips
  `__proto__`/`constructor`/`prototype`; arrays/scalars/null replace, objects recurse);
  `validate.ts` (`validate(raw): Settings` walks DEFAULTS, drops unknown/invalid→default,
  never throws; `accounts[]` field-whitelisted so no secrets); `migrate.ts` (version-stamped
  forward `MIGRATIONS`, v1 baseline + a loop-mechanism test); `appearance.ts` (pure
  `applyAppearance(target, appearance)` → CSS vars `--editor-font-size`/`--accent`/
  `--font-body`(composed w/ fallback stack)/`--reading-width`; theme → `color-scheme` +
  `data-theme`). lineWidth stays the SPEC §8 **enum** {narrow,medium,wide}, mapped to px here.
- **S7b — service + backend** (`backend.ts`, `service.ts`, `tauri-backend.ts`):
  `SettingsBackend` = raw-string I/O (`readUser`/`readSystem`/`writeUser`); **null ⇒ absent
  file, reject ⇒ real I/O error** (service defaults-and-continues on null, surfaces the
  latter). `InMemorySettingsBackend` test double (seedable + failure flags + records writes).
  `SettingsService` (framework-free): `load/get/getValue/update/set/subscribe/flush`;
  **minimal-diff persistence** (store only `userOverrides`, recompute effective =
  `deepMerge(system, validate(userOverrides))`); **no-op write guard in `update()`** (skip
  persist+notify when effective is unchanged → boot-seeding can't loop, the write-loop the
  panel flagged); validate user tier again before persist; deep-frozen `get()` snapshot.
  `tauri-backend.ts` kept **in** coverage via a `vi.mock('@tauri-apps/api/core')` test (no
  silent gap).
- **S7c — Rust** (`src-tauri/src/lib.rs`): refactor `write_file`'s body into a private
  `write_atomic(path, content)`; add `read_settings_file(app, which)` (Ok(None) on missing,
  Err on real I/O) + `write_settings_file(app, content)` (user.json only; `create_dir_all`
  then `write_atomic`). Config dir = `app.path().app_config_dir()` (leaf is the bundle id
  `com.zhaostephen.szmde` — Tauri convention; §8's "szmde" was illustrative; documented).
  Extract a pure `settings_path(base, which)` so dir/path logic is cargo-testable w/o an
  AppHandle. cargo tests for `write_atomic` + `settings_path` + the None/Err split.
- **S7d — wiring**: `store.svelte.ts` (Svelte-5 runes adapter — getter-object export,
  `$effect`→`applyAppearance`; **coverage-excluded** as framework glue, since vitest has no
  Svelte plugin — add `src/**/*.svelte.ts` to the exclude with a reason); `+page.svelte` boot
  (seed render-mode/indent via `EditorApi`, eol + appearance from effective settings) + chip
  write-back (the existing `onrendermode`/`onindentstate`/`toggleEol` handlers call
  `service.set(...)`); `theme.ts` `.cm-content` maxWidth → `var(--reading-width, 740px)`.
  Then catalog `REQ-SET-1/2/3`.

## New / changed files (anticipated)

- **New:** `src/lib/editor/images.ts` (S3), `src/lib/editor/tables.ts` (S5),
  alert logic in `blocks.ts` (S4) or `src/lib/editor/alerts.ts`; HR + task logic in
  `markers.ts` or small siblings (`hr.ts`, `tasks.ts`). `src/lib/settings/{schema,merge,store}.ts`
  (S7). Test files per slice (above).
- **Changed:** `setup.ts` (register the new plugins + table block widget), `theme.ts` (HR,
  checkbox, image, alert, table CSS), `+page.svelte` (settings-backed status bar; image src
  resolver injection), `src-tauri/src/lib.rs` (settings commands), `traceability.md` (new IDs).

## Decisions taken (defaults — overridable)

| # | Decision | Default chosen |
|---|----------|----------------|
| Tables in M2 | render vs full edit | **Render-only + reveal-to-source**; rich editing is §7.4 (deferred) |
| Image local paths | how to resolve | **Injected `resolveImageSrc` hook** (Tauri `convertFileSrc` later); remote/data pass through |
| GFM alerts | grammar node vs detect | **Detect** in the decoration layer (no Lezer node); on-disk stays plain GFM |
| Task toggle | edit text vs attribute | **Edit the on-disk `[ ]`⇄`[x]`** (file stays the source of truth) |
| Settings validation | library vs hand-rolled | **Hand-rolled, dependency-free** (deterministic, unit-testable) |
| Settings location | per platform | OS config dir via Tauri; `system.json` read-only, `user.json` written atomically |
| Reveal model | per construct | **Reuse M1 reveal-on-cursor** for image/HR/table (caret in construct → raw source) |

## Risks (carried + new)

1. **Wrong node names** (M1 risk #1) — mitigated: node names probed against the real parser
   (table above). Re-probe if the grammar/extensions change.
2. **Block widgets vs cursor/height-map desync** (M1 risk #2) — tables use a block
   widget/replace; keep the caret model sane via reveal-to-source rather than editing through
   the widget (defer that to §7.4). Padding/border, never margin (M0 lesson).
3. **Image load = layout shift / async** — reserve space / fixed max-height; never block the
   keystroke path; remote loads are async and must not churn decorations.
4. **Alert detection false positives** — only a blockquote whose *first* content line is
   exactly `[!TYPE]` is an alert; anything else stays a normal quote.
5. **Settings cor/partial files** — invalid JSON or keys fall back to defaults (never throw
   into a broken editor); user.json write is atomic (temp+rename, reuse M1 helper).
