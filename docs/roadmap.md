# szmde roadmap & milestone tracker

_The authoritative schedule. **Every piece of work has a SPEC section, a milestone, and a
requirement ID before it is started — no ad-hoc work.** [SPEC.md](../SPEC.md) §10 is the
high-level sketch; this doc is the tracker (what's shipped, what's scheduled, what's backlog),
and per-milestone build breakdowns live in `docs/m<N>-plan.md`. When a requirement is built it
moves into [requirements.md](requirements.md) with linked tests._

_Status: ✅ shipped · 🔜 next · ⬜ planned · 🅑 backlog (specced, unscheduled — order TBD)._

_Ordering of post-v1 milestones (M3+) and the entire backlog is **tentative** — SPEC §11 defers
post-v1 prioritization. Re-order freely; the point is that each item is already attached to a
spec + milestone + requirement so it can be scheduled without inventing scope._

## Shipped (v1 feature set complete)

| Milestone | Scope | SPEC | Plan | Status |
|-----------|-------|------|------|--------|
| M0 — Skeleton | Tauri+Svelte+CM6 boot, blank canvas, hamburger, local open/save (+WSL UNC), CLI launcher, dark theme | §10.1, §2.1, §6.1 | — | ✅ |
| M1 — Core WYSIWYG | render modes 1–3, markdown shortcuts, bold/italic/strike/headings/quote/lists/code/links, EOL+indent+status widgets, perf | §4, §10.2 | [m1-plan.md](archive/m1-plan.md) | ✅ |
| Testing gate | 100% unit coverage (ratcheted), integration tests, requirement↔test traceability | §10.3 | [testing-strategy.md](testing-strategy.md) | ✅ |
| M2 — Remaining v1 blocks + settings | HR, task lists, images, GFM alerts, tables (render), nested lists, two-tier settings | §5.1, §8, §10.4 | [m2-plan.md](archive/m2-plan.md) | ✅ |
| CI/CD + branch workflow | GitHub Actions: CI gate (typecheck/build/test/coverage/traceability + Rust fmt/clippy/test) on push+PR; tag-triggered Windows release (unsigned); switch to branch/PR development | — | [ci-cd.md](ci-cd.md) | ✅ |

This completes the **§5.1 v1 markdown feature set** + the settings system. Everything below is post-v1.

## What's left

**M5 is now complete** (the S7 header toggle shipped), so everything through **M5 is done**. What's
next:

| Item | REQ | State |
|------|-----|-------|
| **Least-privilege Google Drive picker** — built (scope → `drive.file`, system-browser Picker, hardened loopback); remaining: the live pick→open→save round-trip in the dev app (**WF-28**, user-run) | REQ-CLOUD-3 | ✅ code + tests (catalogued in [requirements.md](requirements.md)); 🔜 live verify |
| OneDrive live wiring (connect orchestration + UI, mirroring `gdrive-connect.ts`) | REQ-CLOUD-2 | ⬜ **deferred** (deprioritized 2026-07-11) — backend + unit tests done, not live-wired |
| **M6 — Android** (current milestone) | REQ-MOBILE-* | 🚧 in progress — S1 cross-compiles on all 4 ABIs + `gen/android` committed; [m6-plan.md](m6-plan.md) |

_Parked (specced-lite, unscheduled):_ keyboard entry into the inline table-cell editor; Google Docs →
markdown export (native Google Docs return `403` on `alt=media`, so only true `.md` / binary Drive
files open today).

## Post-v1 milestone slots

> **Milestones are fixed, in-order slots** — M3, M4, M5, … always ascending = execution order
> (**M3–M5 are shipped; M6 is next**). You schedule by **moving requirements between slots** (and in/out of the unslotted
> pools below); a slot's **title just reflects whatever requirements it currently holds** and is
> retitled as they flow. The stable handles are the requirement IDs (`REQ-*`) — refer to those, not
> milestone numbers, since a milestone's contents and title are fluid. Order is yours to set (§11).
>
> _Last reslotted 2026-06-27: **authoring essentials (REQ-EMOJI/FR/COUNT/FOLD/ZOOM/RENDER-9)
> moved ahead of rich table editing (REQ-TBLED-*)** — now the M4 and M5 slots respectively (the
> two slots' requirements were swapped; numbers stay ascending). Earlier the same day: both sets
> were pulled ahead of Android, shifting Android/network/workspace down a slot each._

### M3 — Cloud storage ✅  (SPEC §6, §8)
_Shipped ([m3-plan.md](archive/m3-plan.md)). The `StorageProvider` seam + `LocalProvider` (S1); the
resilience layer — conflict (S2) / autosave (S3) / offline queue (S4); the `SecureStore` seam +
token model (S5); the OAuth 2.0 + PKCE flow (S6); and both cloud backends (S7–S8)._
_**Google Drive is live-wired** (L1 OS keyring + L2 loopback redirect-capture + plugin-http
transport) with the open→edit→save round-trip user-verified. It uses the **full
`https://www.googleapis.com/auth/drive` scope** — required to open pre-existing files; the narrower
`drive.file` only sees app-created files (see [m3-cloud-setup.md](m3-cloud-setup.md)). **OneDrive is
backend-only** (provider + unit tests); its live wiring (an `onedrive-connect` orchestration + UI
entry) is still pending — see [What's left](#whats-left)._
| REQ | Requirement | SPEC | Status |
|-----|-------------|------|--------|
| REQ-SAVE-1 | Save conflict detection (etag/mtime) + overwrite/save-copy/reload | §6 | ✅ S2 |
| REQ-SAVE-2 | **Autosave** + interval (wires the reserved `editor.autosave`/`autosaveIntervalMs` settings) | §8 | ✅ S3 |
| REQ-SAVE-3 | Offline local-draft cache + queued writes until reconnect | §6 | ✅ S4 (logic; live with Drive) |
| REQ-SEC-1 | OAuth tokens in the OS secure store (Credential Manager / Keychain / Keystore) | §6 | ✅ S5 + L1 (Windows Credential Manager) |
| _(seam)_ | OAuth 2.0 + PKCE + token refresh (provider-agnostic) | §6 | ✅ S6 + L2 (loopback redirect capture) |
| REQ-CLOUD-1 | Google Drive backend (OAuth + Drive REST) behind the StorageProvider interface | §6 | ✅ S7 + **live** (full `drive` scope) |
| REQ-CLOUD-2 | OneDrive backend (OAuth + Microsoft Graph) | §6 | ✅ S8 backend — **not live-wired** |

### M4 — Authoring essentials ✅  (SPEC §5.4, §7.3, §4.1)
Daily-authoring + reading-experience power-features for the target user (Stephen).
Pulled ahead of table editing on 2026-06-27. **Shipped 2026-06-28 (S1–S6,
[m4-plan.md](archive/m4-plan.md)); all six REQs catalogued in [requirements.md](requirements.md).**
| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-EMOJI-1 | Emoji shortcodes `:smile:` → rendered emoji | §5.4 |
| REQ-FR-1 | Find & replace (incl. regex) | §5.4 |
| REQ-COUNT-1 | Word / character count (bottom-right status area) | §5.4, §7.1 |
| REQ-FOLD-1 | Collapsible / foldable sections & headings | §5.4 |
| REQ-ZOOM-1 | Ctrl/Cmd+scroll → zoom base text size (persists to `appearance.fontSize`) | §7.3 |
| REQ-ZOOM-2 | Shift+scroll → page width (persists to `appearance.lineWidth`; the `--reading-width` var already exists) | §7.3 |
| REQ-RENDER-9 | **Syntax mode:** block markers (heading `#`/`##`…, blockquote `>`) hang in the LEFT margin as an overhanging indent, right-aligned to the content margin, so text stays flush (the §4.1 deferred refinement) | §4.1 |

### M5 — Rich table editing ✅  (SPEC §7.4)
Absorbs the M2 table deferrals. On-disk stays portable GFM pipe tables. **Complete: S1–S6 (PR #4,
[m5-plan.md](archive/m5-plan.md)) + S7 (header toggle).** Reachable via a right-click menu, hover
gizmos, and keybindings.
| REQ | Requirement | SPEC | Status |
|-----|-------------|------|--------|
| REQ-TBLED-1 | Insert an N×M table from scratch (grid picker / command, not hand-typed) | §7.4 | ✅ S6 |
| REQ-TBLED-2 | Toggle the header row on/off (lossless: demote header↔promote row) | §7.4 | ✅ S7 |
| REQ-TBLED-3 | Insert/delete rows & columns at any position (before/after/between) | §7.4 | ✅ S3 |
| REQ-TBLED-4 | Drag to reorder columns/rows | §7.4 | ✅ S5 |
| REQ-TBLED-5 | Cursor-context shortcuts (move/insert/delete current row/col) | §7.4 | ✅ S3 |
| REQ-TBLED-6 | Auto-tidy source + per-column alignment UI (`:--`/`:-:`/`--:`) | §7.4 | ✅ S4 |
| REQ-TBLED-7 | Edit-in-place: the **table stays rendered** while you edit a cell — a rendered table is atomic (arrows skip past it); clicking a cell opens an **inline editor** (a `<textarea>` over that cell showing its markdown source; Enter/Tab commit + move, Esc cancels, blur commits). Raw pipe source shows in **Source mode** only _(supersedes the earlier "caret lands at the clicked char / arrows enter the table" design)_ | §7.4, §5.1 | ✅ S2 |

### Least-privilege Google Drive picker ✅  (REQ-CLOUD-3, SPEC §6)
Shipped 2026-07-11 (ahead of the numbered M6+ slots; OneDrive deprioritized the same day). The
restricted full-`drive` scope is replaced by the non-sensitive **`drive.file`** scope; pre-existing
files open via Google's **system-browser desktop Picker** (`trigger_onepick=true`) over the existing
OAuth loopback — **no CSP change, no authorized JS origin, no token in page JS**, and the loopback
is hardened (`Host` allowlist, cancel handling). The S1 spike confirmed a bare `127.0.0.1` redirect
works (no HTTPS relay — S4 skipped). Design: **[gdrive-picker-plan.md](gdrive-picker-plan.md)**.
| REQ | Requirement | SPEC | Status |
|-----|-------------|------|--------|
| REQ-CLOUD-3 | Open pre-existing Drive files via the system-browser Google Picker (`drive.file` + `trigger_onepick`), replacing the full-`drive` restricted scope + its unverified-app warning | §6 | ✅ (live round-trip → WF-28) |

### M6 — Android 🔜  (SPEC §2)
**In progress ([m6-plan.md](m6-plan.md)).** Local-first: boot on an emulator → responsive/touch → soft
keyboard → SAF file open/save → signed **APK** → Drive **sign-in** (deep-link, since the desktop
`127.0.0.1` OAuth loopback is invalid on Android — Google deprecated it for mobile, so Drive moves to
an **https App Link** redirect + a separate Android OAuth client). Needs a real toolchain setup
(JDK 17, Android SDK/NDK, rustup targets — see the plan). **Scope decided 2026-07-18:** M6 = S1–S6;
the Drive **Picker** (opening pre-existing files) is deferred to **M6.1**; Play Store is its own later
milestone (REQ-PLAY-1). Progress: `keyring` 3→4 (S1 prep, PR #13) + responsive shell (S2, PR #14) +
**S1 landed** — `cfg(desktop)`-gated the CLI + loopback OAuth, `tauri android init` (`gen/android`
committed), and the app cross-compiles on all 4 ABIs. On-device emulator boot pending a test device;
APK packaging pending Windows Developer Mode.
| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-MOBILE-1 | Tauri 2 mobile build → sideload signed **APK** (Play Store = REQ-PLAY-1, later) | §2 |
| REQ-MOBILE-2 | Responsive UI from desktop down to phone widths (touch, soft keyboard, safe-areas) | §7 |
| REQ-MOBILE-3 | Storage Access Framework / scoped storage backend (`SafProvider` over `content://`) | §6 |

_**M6.1** (after M6): the native Google Drive **Picker** on Android (open pre-existing files) —
REQ-CLOUD-3 parity via the GIS `PICKER_OAUTH_TRIGGER` flow; deferred as the highest-uncertainty item._

#### M6.2 — Touch UX pass ⬜  (SPEC §7, §7.4)
_Scoped 2026-07-20 from Stephen's on-device Android review; parked out of the M6 line so the
local-first S1–S6 ships first ([m6-plan.md](m6-plan.md#m62--touch-ux-pass))._ These share **one root
cause**: szmde's interaction model assumes a **fine pointer (hover + right-click) and a keyboard**, so
where that assumption fails, shipped features don't degrade — they become **unreachable**. M6 makes the
app *run* on Android; **M6.2 makes it usable**.
| REQ | Requirement | SPEC |
|-----|-------------|------|

### M7 — Network storage + polish ⬜  (SPEC §6, §7)
| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-NET-1 | SMB/CIFS backend (desktop, Rust) | §6 |
| REQ-NET-2 | WebDAV backend (desktop + web + Android) | §6 |
| REQ-THEME-1 | **Light + system theme** palettes (the `appearance.theme` hook + `data-theme` already exist) | §7, §8 |
| REQ-A11Y-1 | Accessibility pass: full keyboard op, screen-reader labels, reduced-motion/high-contrast | §7 |

### M8 — Workspace: tabs & splittable panes ⬜  (SPEC §7.2)
| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-WS-1 | Tabs / tab groups (open, close, reorder) | §7.2 |
| REQ-WS-2 | Recursive split panes (side-by-side / top-bottom) with draggable splitters | §7.2 |
| REQ-WS-3 | Drag-and-drop layouting via drop hotzones | §7.2 |
| REQ-WS-4 | Document/buffer registry (one EditorState per open file, independent of panes) | §7.2 |
| REQ-WS-5 | Serializable layout tree + session persistence | §7.2, §8 |

### Polish pool 🅑 (specced, small — unslotted; fold into a milestone slot when ranked)
_(REQ-ZOOM-1/2 were moved into the authoring slot — now M4 — on 2026-06-27.)_
| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-ALT-1 | Alt-key shortcut-hint badges over chrome | §7.5 |
| REQ-HTML-1 | HTML render mode (the `markdown.renderHtml` extension hook) | §5.2, §8 |
| REQ-UL-1 | Underline via the `<u>` HTML allowlist (depends on REQ-HTML-1) | §5.3 |
| REQ-IMG-3 | Desktop local image assets: Tauri `convertFileSrc` + asset-protocol scope + resolve relative to the open file's dir _(M2 follow-up — remote/`data:` work today)_ | §5.1, §6.1 |
| REQ-CLOUD-4 | **Show a cloud file's human-readable name, not its opaque id.** A Drive file opened via the Picker (REQ-CLOUD-3) currently displays its file *id* as the document name; fetch the Drive `name` metadata (`files.get?fields=name`) on open and use it for the filename chip / window title. Generalize to any cloud backend. _(REQ-CLOUD-3 follow-up — reported 2026-07-18)_ | §6 |
| REQ-UI-4 | **Every command needs a pointer-agnostic entry point** (§7.1 "Command reachability"). **Verified gap:** Find & Replace (`REQ-FR-1`, shipped in M4) is bound *only* to `Mod-f` via `searchKeymap` and has **no hamburger entry** — so on a touch-only Android device it is currently **impossible to open**. Add a Find item to the menu, then audit the whole command surface for other keyboard-/hover-/right-click-only paths. _(found on-device 2026-07-20)_ | §7.1, §5.4 |
| REQ-TBLED-8 | **Empty tables and cells keep a usable minimum rendered size** (§7.4). A freshly inserted N×M scaffold is entirely empty, and cell size is currently content-driven (`tables.ts` sets no min width/height), so the cells collapse to near-nothing — invisible and untappable until populated, which is exactly when you most need to aim at them. Needs a min cell width/height, visible empty-cell boundaries, and a placeholder affordance for empty cells/rows/columns. Affects desktop too; **acute on touch**. _(reported 2026-07-20)_ | §7.4 |
| REQ-TBLED-9 | **Coarse-pointer (touch) table-editing UX — not small, needs its own slice.** **Verified gap:** *every* structural affordance is fine-pointer-only — the insert/delete gizmos are `display:none` until `th:hover`/`td:hover` (`theme.ts`), drag handles are hover-revealed, and the action menu is bound to `contextmenu` (right-click). **Touch has neither hover nor right-click, so table editing is entirely unreachable on Android.** Redesign for coarse pointers (e.g. tap-to-select-cell → a persistent action bar, or long-press → action sheet), keeping the hover/right-click paths as a fine-pointer enhancement. _(reported 2026-07-20)_ | §7.4, §7 |
| REQ-FILE-3 | **Rename the document from the status-bar name pill** (§7.1). Clicking the filename widget renames the current document in place — an inline edit that commits through the `StorageProvider` seam so it renames the **real artifact, not just the label**: a local file is renamed on disk (same dir, atomic), a Google Drive file via a `files.update` `name` patch. **Cross-platform (desktop + Android), not phone-specific.** Needs: a `rename` op + `capabilities.rename` on the provider interface (backends that can't rename degrade to a read-only pill); validation (empty / illegal chars / target already exists → reuse the REQ-SAVE-1 conflict path); extension handling; and the Untitled/never-saved case (falls through to Save As). Pairs with **REQ-CLOUD-4** — the pill must show a real name before renaming it is meaningful. _(requested 2026-07-19)_ | §6, §7.1 |
| REQ-UI-3 | **Hamburger-menu storage reorg.** (a) Fold **Open from Google Drive…** into the **Open** section as one of a list of open-source options (Open local file / Open from Google Drive / …future OneDrive/network), each with a stylized per-storage-type **icon**. (b) Move Google Drive **Connect / Disconnect** out to a separate **Storage / accounts management** section (home for future cloud accounts too). `.svelte` UI → covered by a live workflow when built. _(reported 2026-07-18)_ | §6, §7 |
| REQ-PLAY-1 | **Google Play Store release** (a distribution follow-up to M6, which ships a sideload APK): signed **AAB** via `tauri android build --aab`, a Play Console listing, and review/rollout. Its own later milestone — needs a Play Console account + signing/upload-key management. _(decided 2026-07-18)_ | §2 |

### Engineering & test infrastructure ⬜
Not product features, but tracked the same way (no ad-hoc infra work either).
| REQ | Requirement | Ref |
|-----|-------------|-----|
| REQ-TESTINFRA-1 | **First-class live-WebView workflow tests.** Promote the flat [llm-workflow-tests.md](llm-workflow-tests.md) to an `e2e/` directory: one structured (YAML-frontmatter) file per workflow (`id`, `req`, `bug`, `status`, steps), a maintained `e2e/harness.js` (the `window.__T` helpers), and a `check-workflows.mjs` audit that gates the linkage — every workflow → a known `REQ-*`, and every "needs live test" `REQ-*` → a workflow. Execution stays LLM/agent-driven (live WebView + judgment); only the linkage is CI-gateable. | [testing-strategy.md](testing-strategy.md) |

## Backlog 🅑 (SPEC §5.4 orthogonal features — specced, unscheduled, ranked later per §11)

Each is a real requirement with a home the moment it's prioritized — pull into a milestone when ranked.
_(REQ-EMOJI-1, REQ-FR-1, REQ-COUNT-1, REQ-FOLD-1 were promoted to **M4 — Authoring essentials** on 2026-06-27.)_

| REQ | Feature | SPEC |
|-----|---------|------|
| REQ-FN-1 | Footnotes (`[^1]`) | §5.4 |
| REQ-DL-1 | Definition lists | §5.4 |
| REQ-MATH-1 | Math / LaTeX (`$…$`, `$$…$$`) via KaTeX | §5.4 |
| REQ-DIAGRAM-1 | Mermaid / diagram code blocks | §5.4 |
| REQ-FMED-1 | Front-matter (YAML/TOML) structured editing | §5.4 |
| REQ-WIKI-1 | Wiki-links `[[…]]` | §5.4 |
| REQ-CODEHL-1 | Per-language syntax highlighting in fenced code | §5.4 |
| REQ-TOC-1 | Table-of-contents generation | §5.4 |
| REQ-SPELL-1 | Spell check (the reserved `editor.spellcheck` setting) | §5.4, §8 |
| REQ-EXPORT-1 | Export to HTML / PDF | §5.4 |
| REQ-CMT-1 | Comments / annotations | §5.4 |
| REQ-MAP-1 | Outline / document-map sidebar | §5.4 |

## Process

1. **No ad-hoc work.** Anything beyond a trivial fix needs a SPEC section, a milestone here, and
   a REQ ID. If a new need appears, add it to SPEC + this tracker (backlog is fine) first.
2. Starting a milestone → write its `docs/m<N>-plan.md` (architecture + `S<n>` slices), TDD each.
3. Built requirements move into [requirements.md](requirements.md) with linked unit/integration
   tests; live-behavior aspects get a workflow in [llm-workflow-tests.md](llm-workflow-tests.md).
