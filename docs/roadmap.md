# szmde roadmap & milestone tracker

_The authoritative schedule. **Every piece of work has a SPEC section, a milestone, and a
requirement ID before it is started — no ad-hoc work.** [SPEC.md](../SPEC.md) §10 is the
high-level sketch; this doc is the tracker (what's shipped, what's scheduled, what's backlog),
and per-milestone build breakdowns live in `docs/m<N>-plan.md`. When a requirement is built it
moves into [traceability.md](traceability.md) with linked tests._

_Status: ✅ shipped · 🔜 next · ⬜ planned · 🅑 backlog (specced, unscheduled — order TBD)._

_Ordering of post-v1 milestones (M3+) and the entire backlog is **tentative** — SPEC §11 defers
post-v1 prioritization. Re-order freely; the point is that each item is already attached to a
spec + milestone + requirement so it can be scheduled without inventing scope._

## Shipped (v1 feature set complete)

| Milestone | Scope | SPEC | Plan | Status |
|-----------|-------|------|------|--------|
| M0 — Skeleton | Tauri+Svelte+CM6 boot, blank canvas, hamburger, local open/save (+WSL UNC), CLI launcher, dark theme | §10.1, §2.1, §6.1 | — | ✅ |
| M1 — Core WYSIWYG | render modes 1–3, markdown shortcuts, bold/italic/strike/headings/quote/lists/code/links, EOL+indent+status widgets, perf | §4, §10.2 | [m1-plan.md](m1-plan.md) | ✅ |
| Testing gate | 100% unit coverage (ratcheted), integration tests, requirement↔test traceability | §10.3 | [testing-strategy.md](testing-strategy.md) | ✅ |
| M2 — Remaining v1 blocks + settings | HR, task lists, images, GFM alerts, tables (render), nested lists, two-tier settings | §5.1, §8, §10.4 | [m2-plan.md](m2-plan.md) | ✅ |
| CI/CD + branch workflow | GitHub Actions: CI gate (typecheck/build/test/coverage/traceability + Rust fmt/clippy/test) on push+PR; tag-triggered Windows release (unsigned); switch to branch/PR development | — | [ci-cd.md](ci-cd.md) | ✅ |

This completes the **§5.1 v1 markdown feature set** + the settings system. Everything below is post-v1.

## Scheduled milestones

> **Milestones are fixed, in-order slots** — M3, M4, M5, … always ascending = execution order
> (M3 is next). You schedule by **moving requirements between slots** (and in/out of the unslotted
> pools below); a slot's **title just reflects whatever requirements it currently holds** and is
> retitled as they flow. The stable handles are the requirement IDs (`REQ-*`) — refer to those, not
> milestone numbers, since a milestone's contents and title are fluid. Order is yours to set (§11).
>
> _Last reslotted 2026-06-27: **authoring essentials (REQ-EMOJI/FR/COUNT/FOLD/ZOOM/RENDER-9)
> moved ahead of rich table editing (REQ-TBLED-*)** — now the M4 and M5 slots respectively (the
> two slots' requirements were swapped; numbers stay ascending). Earlier the same day: both sets
> were pulled ahead of Android, shifting Android/network/workspace down a slot each._

### M3 — Cloud storage 🔜  (SPEC §6, §8)
_In progress ([m3-plan.md](m3-plan.md)). Shipped: the `StorageProvider` seam +
`LocalProvider` (S1); the resilience layer — conflict (S2) / autosave (S3) / offline
queue (S4); the `SecureStore` seam + token model (S5); and the OAuth 2.0 + PKCE flow
logic (S6). Remaining: the cloud provider slices (S7–S8) — their live wiring needs the
user's OAuth client registrations + the OS-keyring / redirect-capture Tauri commands._
| REQ | Requirement | SPEC | Status |
|-----|-------------|------|--------|
| REQ-SAVE-1 | Save conflict detection (etag/mtime) + overwrite/save-copy/reload | §6 | ✅ S2 |
| REQ-SAVE-2 | **Autosave** + interval (wires the reserved `editor.autosave`/`autosaveIntervalMs` settings) | §8 | ✅ S3 |
| REQ-SAVE-3 | Offline local-draft cache + queued writes until reconnect | §6 | ✅ S4 (logic; activates with cloud) |
| REQ-SEC-1 | OAuth tokens in the OS secure store (Credential Manager / Keychain / Keystore) | §6 | ✅ S5 (seam+model; OS keyring = tail) |
| _(seam)_ | OAuth 2.0 + PKCE + token refresh (provider-agnostic) | §6 | ✅ S6 (logic; redirect capture = tail) |
| REQ-CLOUD-1 | Google Drive backend (OAuth + Drive REST) behind the StorageProvider interface | §6 | ⬜ S7 |
| REQ-CLOUD-2 | OneDrive backend (OAuth + Microsoft Graph) | §6 | ⬜ S8 |

### M4 — Authoring essentials ✅  (SPEC §5.4, §7.3, §4.1)
Daily-authoring + reading-experience power-features for the target user (Stephen).
Pulled ahead of table editing on 2026-06-27. **Shipped 2026-06-28 (S1–S6,
[m4-plan.md](m4-plan.md)); all six REQs catalogued in [traceability.md](traceability.md).**
| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-EMOJI-1 | Emoji shortcodes `:smile:` → rendered emoji | §5.4 |
| REQ-FR-1 | Find & replace (incl. regex) | §5.4 |
| REQ-COUNT-1 | Word / character count (bottom-right status area) | §5.4, §7.1 |
| REQ-FOLD-1 | Collapsible / foldable sections & headings | §5.4 |
| REQ-ZOOM-1 | Ctrl/Cmd+scroll → zoom base text size (persists to `appearance.fontSize`) | §7.3 |
| REQ-ZOOM-2 | Shift+scroll → page width (persists to `appearance.lineWidth`; the `--reading-width` var already exists) | §7.3 |
| REQ-RENDER-9 | **Syntax mode:** block markers (heading `#`/`##`…, blockquote `>`) hang in the LEFT margin as an overhanging indent, right-aligned to the content margin, so text stays flush (the §4.1 deferred refinement) | §4.1 |

### M5 — Rich table editing ⬜  (SPEC §7.4)
Absorbs the M2 table deferrals. On-disk stays portable GFM pipe tables.
| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-TBLED-1 | Insert an N×M table from scratch (grid picker / command, not hand-typed) | §7.4 |
| REQ-TBLED-2 | Toggle the header row on/off | §7.4 |
| REQ-TBLED-3 | Insert/delete rows & columns at any position (before/after/between) | §7.4 |
| REQ-TBLED-4 | Drag to reorder columns/rows | §7.4 |
| REQ-TBLED-5 | Cursor-context shortcuts (move/insert/delete current row/col) | §7.4 |
| REQ-TBLED-6 | Auto-tidy source + per-column alignment UI (`:--`/`:-:`/`--:`) | §7.4 |
| REQ-TBLED-7 | Edit-in-place: caret lands at the clicked char inside any cell; up/down arrows enter the table _(deferred from M2 — render-only click lands at cell start today)_ | §7.4, §5.1 |

### M6 — Android ⬜  (SPEC §2)
| REQ | Requirement | SPEC |
|-----|-------------|------|
| REQ-MOBILE-1 | Tauri 2 mobile build (APK) | §2 |
| REQ-MOBILE-2 | Responsive UI from desktop down to phone widths | §7 |
| REQ-MOBILE-3 | Storage Access Framework / scoped storage backend | §6 |

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
3. Built requirements move into [traceability.md](traceability.md) with linked unit/integration
   tests; live-behavior aspects get a workflow in [llm-workflow-tests.md](llm-workflow-tests.md).
