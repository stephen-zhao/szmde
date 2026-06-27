# M3 — Cloud storage (implementation plan)

_Implementation plan for milestone **M3** (see [roadmap.md](roadmap.md) "M3" for the
requirement slotting and [SPEC.md](../SPEC.md) §6 / §8 for the behavior). SPEC.md is the
"what"; this doc is the "how" — the architecture and the staged `S1…S8` build slices. Same
shape as [m1-plan.md](m1-plan.md) / [m2-plan.md](m2-plan.md)._

_Status legend: ✅ done · 🔜 next · ⬜ planned._

## Scope (from SPEC §6 / §8 / roadmap "M3")

Introduces the **`StorageProvider` abstraction** (SPEC §6) — the seam the editor core talks
to instead of raw filesystem calls — and the cloud + resilience features layered on it:

| REQ | Requirement | Slice |
|-----|-------------|-------|
| _(seam)_ | `StorageProvider` interface + `LocalProvider` refactor (today's inline `invoke` calls move behind it) | S1 |
| REQ-SAVE-1 | Save conflict detection (rev = etag/mtime) + overwrite / save-copy / reload resolution | S2 |
| REQ-SAVE-2 | **Autosave** + interval (wires the reserved `editor.autosave` / `autosaveIntervalMs` settings) | S3 |
| REQ-SAVE-3 | Offline local-draft cache + queued writes, flushed on reconnect | S4 |
| REQ-SEC-1 | OAuth tokens in the OS secure store (Credential Manager / Keychain / Keystore) | S5 |
| _(seam)_ | OAuth 2.0 + PKCE flow + token refresh (provider-agnostic) | S6 |
| REQ-CLOUD-1 | Google Drive backend (OAuth + Drive REST) behind `StorageProvider` | S7 |
| REQ-CLOUD-2 | OneDrive backend (OAuth + Microsoft Graph) | S8 |

The on-disk artifact stays portable GFM markdown everywhere; cloud backends store the same
bytes the local backend would.

Out of scope (explicitly): SMB/CIFS + WebDAV network backends (**M7**, `REQ-NET-*`); the
Android storage-access-framework backend (**M6**, `REQ-MOBILE-3`); rich table editing (**M4**);
authoring features (**M5**). Live-change `watch()` is best-effort/optional per provider, not a
v1 deliverable.

## The testable-core vs. live-wiring boundary (read this first)

M3 has a hard external dependency the rest of the project hasn't had: **OAuth requires
client credentials that only the user can create** (a Google Cloud Console OAuth client; an
Azure app registration), plus integration surfaces that no unit test can exercise — a real
browser-redirect / loopback listener, the OS Credential Manager, and live HTTPS to Google /
Microsoft. The project's discipline is strict TDD + 100% line coverage, so M3 is split along
that line, exactly mirroring how `REQ-CLI-3` (`wsl_to_unc` shells to `wsl.exe`) and
`REQ-FS-1` are already tracked as honest integration gaps:

- **Built + fully unit-tested now (no external deps):** the `StorageProvider` seam and
  `LocalProvider` (S1); all three resilience services — conflict (S2), autosave (S3), offline
  cache/queue (S4) — which are **immediately useful for local files too**; the `SecureStore`
  seam + token model (S5); the OAuth/PKCE + refresh **logic** behind an injected HTTP fn (S6);
  and both cloud providers' request/response/error mapping behind an injected authenticated
  `fetch` (S7/S8). Everything deterministic, mocked at the I/O seam — the established pattern
  (`SettingsBackend` + `InMemorySettingsBackend` + a `vi.mock`'d Tauri impl).
- **Live integration tail (tracked as gaps + LLM workflows, needs the user):** real OAuth
  client IDs in config; the actual redirect/loopback capture in the Tauri shell; the Rust
  Credential-Manager / Keychain / Keystore command; and real network round-trips. These get
  catalogued in [traceability.md](traceability.md) "no automated test" + a workflow in
  [llm-workflow-tests.md](llm-workflow-tests.md), not faked into the unit gate.

> **User action with lead time:** S7/S8 live wiring needs an OAuth **client ID** for each
> service (Google Cloud Console → OAuth 2.0 Client; Azure Portal → App registration, Graph
> `Files.ReadWrite` scope), each configured with a desktop **loopback redirect**
> (`http://127.0.0.1:<port>`). Claude cannot create these. They are only needed when S7/S8
> live wiring lands — S1–S6 do not block on them, so registration can proceed in parallel.

## Architecture (the seam the whole milestone hangs on)

Today `+page.svelte` calls `invoke("read_file"/"write_file")` inline. M3 inserts the **core
service layer** from SPEC §9 between the shell and the native bridge:

```
+page.svelte ─▶ ProviderRegistry ─▶ StorageProvider (local | gdrive | onedrive)
                                          │
                 AutosaveScheduler ───────┤  (debounced save thunk)
                 ConflictGuard ───────────┤  (rev compare on write)
                 OfflineQueue + DraftCache ┘  (queue on offline, flush on reconnect)
                                          │
                            SecureStore ──┤  (OAuth tokens; Rust OS store / in-mem)
                            OAuthClient ──┘  (PKCE + refresh; injected httpPost)
```

### `src/lib/storage/provider.ts` — the interface (SPEC §6)

```ts
export type Revision = string | null;          // opaque version token; null = unknown/unsupported
export interface ReadResult  { content: string; rev: Revision }
export interface WriteResult { rev: Revision }
export interface Capabilities { conflictDetection: boolean; list: boolean; watch: boolean }

export interface StorageProvider {
  readonly id: string;                          // "local" | "gdrive" | "onedrive"
  readonly capabilities: Capabilities;
  read(path: string): Promise<ReadResult>;
  write(path: string, content: string, expectedRev?: Revision): Promise<WriteResult>;
  stat?(path: string): Promise<Revision>;       // current rev without reading body (conflict check)
  list?(path: string): Promise<Entry[]>;
}

export type StorageErrorKind = "not-found" | "conflict" | "offline" | "auth" | "io";
export class StorageError extends Error { constructor(readonly kind: StorageErrorKind, message: string) }
```

- **`Revision`** is the conflict token: local = a `mtime-size` (or hash) composite; cloud =
  the service etag. `null` means the provider can't version → conflict detection degrades off
  (`capabilities.conflictDetection = false`).
- **`write(path, content, expectedRev)`**: when `expectedRev` is supplied, the provider does
  a check-and-set (cloud: `If-Match` etag → a `412` maps to `StorageError("conflict")`; local:
  best-effort stat-before-rename). Omitted ⇒ unconditional write.
- **`StorageError.kind`** is the single error taxonomy every backend maps its failures into,
  so the shell's handling (retry / offline-queue / re-auth / conflict modal) is
  provider-agnostic. Mirrors `SettingsBackend`'s null-vs-reject contract idea.

### Reused project pattern

Every seam gets a **pure interface + an in-memory double** (test default) **+ a thin Tauri
impl kept in coverage via `vi.mock("@tauri-apps/api/core")`** — identical to
`SettingsBackend` / `InMemorySettingsBackend` / `TauriSettingsBackend`. No editor-core
changes; this is service + shell-wiring work. Viewport/decoration layers are untouched.

## Staged build sequence

> Each slice: **failing test(s) first** (TDD, T4), then implementation, then `npm run test` +
> `npm run check` green, update [traceability.md](traceability.md) with the new `REQ-*` IDs and
> tag the tests, then commit. Live-behavior aspects (real OAuth/network/secure-store) get a
> workflow in [llm-workflow-tests.md](llm-workflow-tests.md), not a unit test.

### S1 — `StorageProvider` seam + `LocalProvider` refactor ✅  _(seam; no behavior change)_
Define `provider.ts` (interface + types + `StorageError`). Add `local.ts` (`LocalProvider`
over an **injected** `invoke`, default the real one; `rev: null` for now — capability flags
all false). Add `registry.ts` (`ProviderRegistry`: id → provider; default from
`storage.defaultProvider`). Rewire `+page.svelte`'s `openPath`/`doSave`/`doSaveAs` to go
through the provider (EOL transform stays above the provider). **Pure refactor — behavior
identical.**
**Tests** (`provider.test.ts`, `local.test.ts`, `registry.test.ts`): `StorageError` kind/
instanceof; `LocalProvider.read/write` delegate to the injected invoke with the right args;
invoke rejection → `StorageError("io")`; registry resolves ids + default + unknown-id throw.

### S2 — Save conflict detection ✅  (`REQ-SAVE-1`)
Give `LocalProvider` a real `rev`: extend Rust with `read_file_meta(path) -> {content, rev}`
and `stat_file(path) -> rev?` (`rev = "{mtime_nanos}-{len}"`, pure `compose_rev` cargo-tested).
A pure `ConflictGuard`: the document tracks `baseRev` (rev at open / last successful save);
`write` passes `expectedRev = baseRev`; a `StorageError("conflict")` surfaces a choice →
**overwrite** (re-write with no expectedRev), **save-copy** (write to a new path), or
**reload** (discard local, re-read). The detect + choice→action mapping is pure/TDD'd; the
modal UI is shell wiring (LLM workflow).
**Tests**: `compose_rev` (cargo); `LocalProvider` conflict path (stat ≠ expected → throw);
`ConflictGuard` choice mapping (overwrite/save-copy/reload) over a fake provider.

### S3 — Autosave ✅  (`REQ-SAVE-2`)
`AutosaveScheduler`: `notifyDirty()` debounces by `autosaveIntervalMs`, then calls an injected
`save()` thunk; honors the `editor.autosave` enable flag; `flush()` forces an immediate save
(used by the unsaved-changes guard); `cancel()` on disable/teardown. **Injected clock**
(setTimeout seam) for deterministic tests; coalesces a burst of edits into one save.
**Tests** (`autosave.test.ts`, fake timers): fires once after the interval; rapid edits
coalesce; disabled ⇒ never fires; `flush` saves immediately + clears the pending timer;
a failed save doesn't wedge the scheduler.

### S4 — Offline cache + write queue ✅  (`REQ-SAVE-3`)
`DraftCache` (key = `providerId:path` → latest unsaved content) + `OfflineQueue` (pending
writes held when a write throws `StorageError("offline")`, flushed in order on reconnect;
same-path writes coalesce to the last). Both over an injected persistence seam (in-memory
double now; a local-dir / IndexedDB impl is the integration tail). A `save()` wrapper:
try provider.write → on `offline`, stash draft + enqueue → on reconnect, flush.
**Tests** (`offline.test.ts`): write while offline enqueues + caches the draft; reconnect
flushes in order; repeated same-path writes coalesce; a non-offline error is NOT queued
(re-thrown); draft survives until a successful write clears it.

### S5 — Secure token store ✅  (`REQ-SEC-1`)
`SecureStore` interface (`get/set/delete(key)`) + `InMemorySecureStore` double + a `TokenSet`
model (`access`, `refresh`, `expiresAt`) with pure (de)serialization and an `isExpired(now)`
helper. Tauri impl behind a Rust command over the OS store (Windows Credential Manager via
`keyring`/`tauri-plugin-stronghold` or equiv) — **that command is the integration tail**
(tracked gap), the seam + model are unit-tested.
**Tests** (`secure-store.test.ts`): in-memory get/set/delete roundtrip + absent → null;
`TokenSet` serialize/parse roundtrip; `isExpired` boundary (with skew).

### S6 — OAuth 2.0 + PKCE + refresh ✅  _(seam; provider-agnostic)_
`OAuthClient` logic over an **injected** `httpPost` (mocked in tests): build the authorization
URL with **PKCE** (`code_verifier` → S256 `code_challenge`); exchange `code`→`TokenSet`;
`refresh()` when `isExpired`; persist via `SecureStore`. Pure PKCE (verifier gen, S256+
base64url challenge) and expiry math are unit-tested; the browser-open + loopback **redirect
capture** is the Tauri-shell integration tail.
**Tests** (`oauth.test.ts`): challenge derivation is deterministic for a fixed verifier;
auth-URL params (scope, redirect, challenge, state); token exchange parses the response into a
`TokenSet`; refresh swaps tokens + repersists; an error response → `StorageError("auth")`.

### S7 — Google Drive backend ✅  (`REQ-CLOUD-1`)
`GoogleDriveProvider implements StorageProvider` over an injected **authenticated `fetch`**
(supplied by S6): `read` (files.get `alt=media` + metadata etag → `rev`), `write` (multipart
update with `If-Match` → `412`⇒`conflict`), `stat` (metadata-only etag). Map `401`⇒`auth`
(triggers refresh), network failure⇒`offline`, `404`⇒`not-found`. `capabilities.conflictDetection
= true`. Path↔fileId resolution helper (pure).
**Tests** (`gdrive.test.ts`, mocked fetch): read returns content+rev; write sends If-Match +
parses new rev; 412→conflict, 401→auth, network throw→offline, 404→not-found.
**Live tail:** real client ID + consent + network → LLM workflow.

### S8 — OneDrive backend ✅  (`REQ-CLOUD-2`)
`OneDriveProvider` over Microsoft Graph, same shape as S7 (Graph item content GET; PUT/upload
session with `if-match`; etag→`rev`; `403/401`⇒`auth`). Shared error-mapping + multipart
helpers factored out of S7 so the two backends differ only in endpoints/auth.
**Tests** (`onedrive.test.ts`, mocked fetch): the S7 matrix against Graph response shapes.
**Live tail:** real Azure app + network → LLM workflow.

## New / changed files (anticipated)

- **New:** `src/lib/storage/{provider,local,registry,conflict,autosave,offline,secure-store,
  oauth,gdrive,onedrive}.ts` + co-located `*.test.ts`; `tauri-storage.ts` (the `vi.mock`'d
  invoke wrapper, if S2 adds storage IPC). 
- **Changed:** `+page.svelte` (route open/save through the registry; autosave + conflict modal
  + storage-account connect UI); `src-tauri/src/lib.rs` (`read_file_meta`/`stat_file`;
  secure-store + OAuth-redirect commands in the integration tail); `HamburgerMenu.svelte`
  ("Storage account connections"); `traceability.md` (new IDs); `roadmap.md` (mark shipped).

## Decisions taken (defaults — overridable)

| # | Decision | Default chosen |
|---|----------|----------------|
| Build vs. defer | OAuth/network/secure-store live wiring | **Build the testable core (S1–S8 logic) now; defer live wiring** as tracked gaps + LLM workflows (matches `REQ-CLI-3`/`REQ-FS-1`) |
| Cloud order | which provider first | **Google Drive (S7) then OneDrive (S8)** — REQ-CLOUD-1 leads; S8 reuses S7's helpers |
| Conflict "merge" | full 3-way vs. simpler | **overwrite / save-copy / reload** in v1 (logic pure-tested); a true diff/merge view is a later polish item if wanted |
| Rev token | hash vs. mtime | **`mtime_nanos-len`** for local (cheap, no full read); service **etag** for cloud |
| Auth flow | implicit vs. code+PKCE | **Authorization Code + PKCE** (no client secret in a desktop app — the correct modern desktop pattern) |
| Token storage | plaintext vs. OS store | **OS secure store** via a Rust command (`REQ-SEC-1`); never in `user.json` (validate already whitelists `accounts[]` to non-secrets) |
| Seam testing | real Tauri vs. inject | **Inject the I/O fn; in-memory doubles**; thin Tauri impls kept in coverage via `vi.mock` (established pattern) |

## Risks

1. **Scope creep into live OAuth** — strictly hold the testable-core/live-wiring line above;
   don't let an un-unit-testable redirect/credential call sneak into a slice. Each live piece
   is a named, tracked gap, not silent.
2. **`+page.svelte` refactor regressing local open/save** (S1) — it's a behavior-preserving
   swap; the provider is unit-tested and the page is covered by the open/save LLM workflows.
   Keep EOL transform above the provider (don't move it down).
3. **Autosave fighting the dirty/undo + conflict logic** — autosave must reuse the same save
   path (rev tracking) so an autosave can also raise a conflict; injected clock keeps tests
   deterministic and off the keystroke path (SPEC §4.3).
4. **Cloud etag semantics differ** (Drive weak etags / Graph quirks) — isolate behind each
   provider's mapping; unit-test against captured response shapes; verify live via workflow.
5. **Secure store availability** varies (headless/CI, Linux without a keyring) — `SecureStore`
   must degrade gracefully (surface `auth` and re-prompt) rather than crash; in-memory double
   documents the contract.
