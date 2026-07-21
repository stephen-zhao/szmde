<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    open as openDialog,
    save as saveDialog,
    message,
  } from "@tauri-apps/plugin-dialog";
  import Editor, { type EditorApi } from "$lib/Editor.svelte";
  import type { WrapState } from "$lib/editor/setup";
  import { MODE_LABELS, MODE_ORDER, type RenderMode } from "$lib/editor/render-mode";
  import type { IndentConfig } from "$lib/editor/indent";
  import type { TextCount } from "$lib/editor/count";
  import { detectEol, fromLf, toLf, type Eol } from "$lib/editor/eol";
  import HamburgerMenu from "$lib/HamburgerMenu.svelte";
  import { settings, initSettings, setSetting, updateSettings } from "$lib/settings/store.svelte";
  import { LocalProvider } from "$lib/storage/local";
  import { StorageError, type Revision, type StorageProvider } from "$lib/storage/provider";
  import { copyPathFor, type ConflictChoice } from "$lib/storage/conflict";
  import { AutosaveScheduler } from "$lib/storage/autosave";
  import {
    connectGoogleDrive,
    disconnectGoogleDrive,
    isGoogleDriveConnected,
    makeGoogleDriveProvider,
    pickGoogleDriveFiles,
  } from "$lib/storage/gdrive-connect";
  import { stepFontSize, stepLineWidth } from "$lib/editor/zoom";

  // File I/O goes through the StorageProvider seam (SPEC §6). The active provider
  // is the open document's: local, or Google Drive once connected (M3 L2).
  const local = new LocalProvider();
  let driveProvider = $state<StorageProvider | null>(null);
  let driveConnected = $state(false);
  let providerId = $state("local");
  function providerFor(id: string): StorageProvider {
    return id === "gdrive" && driveProvider ? driveProvider : local;
  }
  const storage = $derived(providerFor(providerId));

  // Debounced autosave (REQ-SAVE-2). Disabled until effective settings load
  // (initSettings below seeds enabled/interval). Only autosaves a file that has a
  // path and unsaved edits — never pops a Save As dialog for an untitled buffer.
  const autosave = new AutosaveScheduler({
    // Background save: non-interactive (doSave(false)) so a conflict can't pop a
    // modal nobody asked for or wedge the scheduler — it defers to a manual save.
    save: () => (filePath && dirty ? doSave(false) : undefined),
    intervalMs: 2000,
    enabled: false,
  });

  let editor: EditorApi | undefined;
  let filePath = $state<string | null>(null);
  // The on-disk revision at open / last successful save — the conflict baseline
  // (REQ-SAVE-1). Not rendered, so a plain (non-reactive) variable is enough.
  let baseRev: Revision = null;
  let dirty = $state(false);
  let wrapState = $state<WrapState>("on");
  let renderMode = $state<RenderMode>("clean");
  let eol = $state<Eol>("lf");
  let indent = $state<IndentConfig>({ style: "spaces", width: 2 });
  let indentMenuOpen = $state(false);
  let wordCount = $state<TextCount>({ words: 0, chars: 0 });

  // Editor-wide toggle: forces all blocks (clearing per-block overrides).
  // 'off' or 'partial' → turn wrap on for all; 'on' → turn it off for all.
  function toggleCodeWrap() {
    editor?.setCodeWrap(wrapState !== "on");
  }

  function setRenderMode(mode: RenderMode) {
    editor?.setRenderMode(mode);
  }

  // Push effective editor prefs into the live editor. Idempotent + the service's
  // no-op write guard means re-seeding can't trigger a redundant persist, so this
  // is safe to call from both onready and after settings load (whichever is last
  // wins). Reuses the existing imperative EditorApi — no editor reconfiguration.
  function seedEditorFromSettings() {
    if (!editor) return;
    const e = settings.value.editor;
    editor.setRenderMode(e.renderMode);
    editor.setIndent({ style: e.indentStyle, width: e.indentWidth });
    editor.setEmoji(settings.value.markdown.emoji);
  }

  function cycleRenderMode() {
    editor?.setRenderMode(MODE_ORDER[(MODE_ORDER.indexOf(renderMode) + 1) % MODE_ORDER.length]);
  }
  // The chip lives in the toolbar, so clicking it blurs the editor — restore focus
  // so editor shortcuts keep working. The keyboard fallback does NOT do this: it
  // must not yank focus out of a legitimately-focused control (e.g. the Find panel
  // input), which would lose the user's place there.
  function cycleRenderModeFromChip() {
    cycleRenderMode();
    editor?.focus();
  }

  // EOL is write-time metadata (the buffer is always LF); toggling marks the
  // document dirty so the new line ending is written on Save (SPEC §4.4).
  function toggleEol() {
    eol = eol === "lf" ? "crlf" : "lf";
    dirty = true;
    setSetting("editor.defaultEol", eol); // persist as the default for new docs
  }

  const indentLabel = $derived(indent.style === "tab" ? "Tab" : `Spaces: ${indent.width}`);
  function chooseIndent(config: IndentConfig) {
    indentMenuOpen = false;
    editor?.setIndent(config);
  }
  function convertIndent() {
    indentMenuOpen = false;
    editor?.convertIndentation();
  }

  const MD_FILTERS = [
    { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] },
  ];

  const fileName = $derived(
    filePath ? (filePath.split(/[\\/]/).pop() ?? filePath) : "Untitled",
  );

  // --- Unsaved-changes confirmation modal (promise-based) ---------------------
  type Choice = "save" | "discard" | "cancel";
  let confirmOpen = $state(false);
  let confirmResolve: ((c: Choice) => void) | null = null;

  function askUnsaved(): Promise<Choice> {
    // Re-entrancy guard: only one prompt may be in flight. A second concurrent
    // destructive path (a forwarded open-file event, or the window-close
    // handler) must NOT overwrite the pending resolver — that would orphan the
    // first promise (hanging its caller) and decouple the action from the
    // prompt the user is answering. The guard is cross-modal: never raise this
    // while the conflict modal is up either (no stacked, partly-unreachable
    // dialogs). Such callers simply cancel.
    if (confirmResolve || conflictResolve) return Promise.resolve("cancel");
    confirmOpen = true;
    return new Promise<Choice>((resolve) => {
      confirmResolve = resolve;
    });
  }
  function resolveConfirm(choice: Choice) {
    confirmOpen = false;
    confirmResolve?.(choice);
    confirmResolve = null;
    editor?.focus(); // return focus to the canvas
  }

  // Focus trap: move focus into the modal on open so keystrokes can't reach the
  // editor behind it (window-level preventDefault runs after CM's own handler, so
  // taking focus is the reliable guard).
  function trapFocus(node: HTMLElement) {
    node.focus();
  }

  // --- Save-conflict modal (promise-based) — REQ-SAVE-1 -----------------------
  type ConflictModalChoice = ConflictChoice | "cancel";
  let conflictOpen = $state(false);
  let conflictResolve: ((c: ConflictModalChoice) => void) | null = null;

  function askConflict(): Promise<ConflictModalChoice> {
    // One destructive prompt at a time — cross-modal (don't stack on the
    // unsaved-changes modal either).
    if (conflictResolve || confirmResolve) return Promise.resolve("cancel");
    conflictOpen = true;
    return new Promise<ConflictModalChoice>((resolve) => {
      conflictResolve = resolve;
    });
  }
  function resolveConflictModal(choice: ConflictModalChoice) {
    conflictOpen = false;
    conflictResolve?.(choice);
    conflictResolve = null;
    editor?.focus(); // return focus to the canvas
  }

  /** Returns true if the caller may proceed to replace/close the buffer. */
  async function guardUnsaved(): Promise<boolean> {
    if (!dirty) return true;
    const choice = await askUnsaved();
    if (choice === "cancel") return false;
    if (choice === "save") return await doSave();
    return true; // discard
  }

  // --- File operations --------------------------------------------------------
  async function openPath(path: string, pid = "local") {
    try {
      const { content: raw, rev } = await providerFor(pid).read(path);
      const detected = detectEol(raw);
      eol = detected === "mixed" ? "lf" : detected; // mixed normalizes to LF on save
      editor?.setContent(toLf(raw)); // the editor buffer is always LF
      // Switch the active provider only AFTER a successful read, so a failed open
      // (auth/offline/bad id) leaves the currently-open document untouched.
      providerId = pid;
      filePath = path;
      baseRev = rev; // conflict baseline (REQ-SAVE-1)
      dirty = false;
      editor?.focus();
    } catch (e) {
      await message(`Couldn't open the file:\n${path}\n\n${e}`, {
        title: "Open failed",
        kind: "error",
      });
    }
  }

  async function doNew() {
    if (!(await guardUnsaved())) return;
    editor?.setContent("");
    filePath = null;
    baseRev = null;
    providerId = "local"; // new docs are local until saved elsewhere
    dirty = false;
    eol = settings.value.editor.defaultEol; // new docs use the persisted default (SPEC §4.4)
    editor?.focus();
  }

  async function doOpen() {
    if (!(await guardUnsaved())) return;
    const selected = await openDialog({ multiple: false, filters: MD_FILTERS });
    if (typeof selected === "string") await openPath(selected);
  }

  // `interactive` distinguishes a user-initiated save (may raise the conflict
  // modal) from a background autosave (must never pop UI or block).
  async function doSave(interactive = true): Promise<boolean> {
    if (!filePath) return interactive ? doSaveAs() : false; // never auto-pop Save As
    return writeTo(filePath, baseRev, interactive); // baseline rev → conflict-checked
  }

  async function doSaveAs(): Promise<boolean> {
    const path = await saveDialog({
      filters: MD_FILTERS,
      defaultPath: filePath ?? "Untitled.md",
    });
    if (!path) return false;
    providerId = "local"; // a chosen filesystem path is local, even from a Drive doc
    return writeTo(path, null); // a user-chosen new path → unconditional write
  }

  /**
   * Persist the buffer to `path`, passing `expectedRev` for conflict detection
   * (REQ-SAVE-1). On a detected conflict, an interactive save prompts overwrite /
   * save-copy / reload; a background (autosave) save backs off without UI so it
   * can't pop a modal nobody asked for or wedge the scheduler. Returns true once
   * the content is durably persisted; false if cancelled, errored, deferred, or
   * the user reloaded the on-disk version over their edits.
   */
  async function writeTo(path: string, expectedRev: Revision, interactive = true): Promise<boolean> {
    // Snapshot exactly what we send so a slow write can't clear the dirty flag
    // for edits the user makes while it's in flight (data-loss race).
    const snapshot = editor?.getContent() ?? "";
    try {
      const { rev } = await storage.write(path, fromLf(snapshot, eol), expectedRev);
      filePath = path;
      baseRev = rev; // on disk now == snapshot
      if ((editor?.getContent() ?? "") === snapshot) {
        dirty = false; // buffer unchanged since the snapshot → truly clean
      } else {
        autosave.notifyDirty(); // edits arrived mid-write; keep dirty, re-arm save
      }
      return true;
    } catch (e) {
      if (e instanceof StorageError && e.kind === "conflict") {
        if (!interactive) return false; // autosave: defer to the next manual save
        return resolveSaveConflict(path);
      }
      await message(`Couldn't save the file:\n${path}\n\n${e}`, {
        title: "Save failed",
        kind: "error",
      });
      return false;
    }
  }

  async function resolveSaveConflict(path: string): Promise<boolean> {
    const choice = await askConflict();
    if (choice === "cancel") return false;
    if (choice === "overwrite") return writeTo(path, null); // force over their change
    if (choice === "save-copy") return writeTo(await freeCopyPath(path), null); // keep both
    // reload: discard our edits, take the on-disk version.
    try {
      const { content, rev } = await storage.read(path);
      const detected = detectEol(content);
      eol = detected === "mixed" ? "lf" : detected;
      editor?.setContent(toLf(content));
      baseRev = rev;
      dirty = false;
    } catch (e) {
      await message(`Couldn't reload the file:\n${path}\n\n${e}`, {
        title: "Reload failed",
        kind: "error",
      });
    }
    return false; // our edits were discarded — not a "save"
  }

  // Find a copy-target that doesn't already exist, so "Save a copy" never
  // clobbers a previously-kept copy: notes (copy).md, notes (copy 2).md, …
  async function freeCopyPath(path: string): Promise<string> {
    if (!storage.stat) return copyPathFor(path); // provider can't check existence
    for (let n = 1; n < 1000; n++) {
      const candidate = copyPathFor(path, n);
      if ((await storage.stat(candidate)) === null) return candidate;
    }
    return copyPathFor(path, 1000); // pathological fallback (1000 copies already exist)
  }

  async function doExit() {
    if (!(await guardUnsaved())) return;
    await getCurrentWindow().destroy();
  }

  // --- Google Drive (M3 L2) ---------------------------------------------------
  let driveConnecting = false; // re-entrancy guard — one handshake at a time
  async function doConnectDrive() {
    if (driveConnecting) return; // a connect flow is already in progress
    driveConnecting = true;
    try {
      await connectGoogleDrive(); // opens the system browser; user signs in
      driveProvider = await makeGoogleDriveProvider();
      driveConnected = driveProvider !== null;
      await message("Google Drive connected.", { title: "Google Drive" });
    } catch (e) {
      await message(`Couldn't connect Google Drive:\n${e}`, {
        title: "Connect failed",
        kind: "error",
      });
    } finally {
      driveConnecting = false;
    }
  }

  async function doDisconnectDrive() {
    await disconnectGoogleDrive();
    driveProvider = null;
    driveConnected = false;
    if (providerId === "gdrive") {
      // The open doc lived on Drive — detach it to an unsaved local buffer so a
      // save can't route a Drive id to the local disk; the next save is a Save As.
      providerId = "local";
      filePath = null;
      baseRev = null;
      dirty = true;
    }
  }

  async function doOpenDrive() {
    if (!(await guardUnsaved())) return;
    if (driveConnecting) return; // one browser handshake at a time (shared with connect)
    driveConnecting = true;
    try {
      // The Google Picker opens in the system browser (REQ-CLOUD-3). The pick session
      // DOUBLES as sign-in — its code exchange persists fresh drive.file tokens and
      // grants per-file access to whatever the user picked — so no separate connect
      // is needed first, and no paste-an-id prompt (the Picker replaced it).
      const ids = await pickGoogleDriveFiles();
      // Tokens are persisted the moment the pick resolves, so sync the connection
      // state BEFORE any early return — else a consent-but-no-file-picked would leave
      // the menu wrongly offering "Connect Google Drive…" despite a live session.
      driveProvider = await makeGoogleDriveProvider();
      driveConnected = driveProvider !== null;
      if (ids.length === 0) {
        editor?.focus();
        return; // consent completed, nothing picked
      }
      await openPath(ids[0], "gdrive");
    } catch (e) {
      // A deliberate cancel (declined consent/Picker) returns silently, like
      // cancelling the native file dialog — only surface real failures.
      if (!/declined/i.test(String(e))) {
        await message(`Couldn't open from Google Drive:\n${e}`, {
          title: "Google Drive",
          kind: "error",
        });
      }
      editor?.focus();
    } finally {
      driveConnecting = false;
    }
  }

  // --- Shortcuts --------------------------------------------------------------
  function onKeydown(e: KeyboardEvent) {
    // While a modal is open, swallow EVERY key (not just its shortcuts) so nothing
    // leaks into the editor behind it. Focus is also trapped into the modal (see
    // use:trapFocus), so CM never receives the keystroke in the first place; this
    // is the belt to that suspenders, and maps the modal's own shortcuts.
    if (conflictOpen) {
      e.preventDefault();
      if (e.key === "Escape") resolveConflictModal("cancel");
      return;
    }
    if (confirmOpen) {
      e.preventDefault();
      if (e.key === "Escape") resolveConfirm("cancel");
      else if (e.key === "Enter") resolveConfirm("save");
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    // When the editor is focused, CodeMirror's own keymap handles its shortcuts
    // and marks the event handled — skip those here so we never double-fire.
    if (e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      e.shiftKey ? doSaveAs() : doSave();
    } else if (k === "o") {
      e.preventDefault();
      doOpen();
    } else if (k === "n") {
      e.preventDefault();
      doNew();
    } else if (k === "m" && e.shiftKey) {
      // Render-mode cycle (Ctrl+Shift+M). Also handled by CM when the editor has
      // focus; this app-level fallback keeps the shortcut working after focus has
      // drifted to a toolbar control (else clicking the mode chip, then pressing
      // the shortcut, would silently do nothing — the "stuck toggle" bug).
      e.preventDefault();
      cycleRenderMode();
    }
  }

  onMount(() => {
    // Register the forwarded-open listener FIRST (before any await) so a
    // second `szmde <file>` instance can't have its event dropped in the gap.
    const unlistenP = listen<string>("open-file", async (event) => {
      if (await guardUnsaved()) await openPath(event.payload);
    });

    // Guard the native window close (X / Alt+F4) against unsaved changes.
    const unCloseP = getCurrentWindow().onCloseRequested(async (e) => {
      if (!dirty) return;
      e.preventDefault();
      const choice = await askUnsaved();
      if (choice === "cancel") return;
      if (choice === "save" && !(await doSave())) return;
      await getCurrentWindow().destroy();
    });

    // File passed on the command line: `szmde notes.md` (SPEC §2.1).
    invoke<string | null>("get_launch_file").then((launch) => {
      if (launch) openPath(launch);
    });

    // Re-establish a previously connected Google Drive account (M3 L2).
    isGoogleDriveConnected().then(async (connected) => {
      if (connected) {
        driveProvider = await makeGoogleDriveProvider();
        driveConnected = driveProvider !== null;
      }
    });

    // Load persisted settings (§8), then seed the editor + new-doc EOL from them.
    // Runs concurrently with get_launch_file; an opened file's detected EOL still
    // wins (openPath overwrites `eol`), so defaultEol only governs new docs.
    initSettings().then((eff) => {
      if (!filePath) eol = eff.editor.defaultEol;
      seedEditorFromSettings();
      // Seed autosave from effective settings (REQ-SAVE-2).
      autosave.setIntervalMs(eff.editor.autosaveIntervalMs);
      autosave.setEnabled(eff.editor.autosave);
    });

    return () => {
      autosave.cancel();
      unlistenP.then((un) => un());
      unCloseP.then((un) => un());
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <HamburgerMenu
    onnew={doNew}
    onopen={doOpen}
    onsave={doSave}
    onsaveas={doSaveAs}
    onexit={doExit}
    onopendrive={doOpenDrive}
    onconnectdrive={doConnectDrive}
    ondisconnectdrive={doDisconnectDrive}
    {driveConnected}
    {wrapState}
    ontogglewrap={toggleCodeWrap}
    {renderMode}
    onsetrendermode={setRenderMode}
    oninserttable={(rows, cols) => editor?.insertTable(rows, cols)}
  />

  <Editor
    onready={(api) => {
      editor = api;
      seedEditorFromSettings();
    }}
    onchange={() => {
      dirty = true;
      autosave.notifyDirty();
    }}
    onwrapstate={(s) => (wrapState = s)}
    onrendermode={(m) => {
      renderMode = m;
      setSetting("editor.renderMode", m); // persist (no-op-guarded at boot)
    }}
    onindentstate={(c) => {
      indent = c;
      updateSettings({ editor: { indentStyle: c.style, indentWidth: c.width } });
    }}
    oncount={(c) => (wordCount = c)}
    onzoomfont={(s) =>
      setSetting("appearance.fontSize", stepFontSize(settings.value.appearance.fontSize, s))}
    onzoomwidth={(s) =>
      setSetting(
        "appearance.lineWidth",
        // Cap the column at the current window width so it can grow "as wide as the
        // window" but no wider (REQ-ZOOM-3); the CSS min() handles clinging on shrink.
        stepLineWidth(settings.value.appearance.lineWidth, s, window.innerWidth),
      )}
  />

  <!-- Bottom-right status bar (§7.1): filename + click-to-edit chips. Tiny and
       low-contrast to honor the blank-canvas ethos (requirement 9). Hidden when
       appearance.showStatusWidgets is off (§7.1 / settings §8). -->
  {#if settings.value.appearance.showStatusWidgets}
  <div class="statusbar">
    <span class="status-name">{fileName}{dirty ? " •" : ""}</span>
    <!-- Zero-height flex line-break: on phones it forces the filename onto its own row
         above the chips. A `flex-basis:100%` on .status-name itself would stretch its
         PILL BACKGROUND across the full width; breaking with a sibling lets the pill keep
         hugging its text. Display:none (inert) on desktop. -->
    <span class="status-row-break" aria-hidden="true"></span>
    {#if settings.value.appearance.showWordCount}
      <span class="chip chip-readonly" title="{wordCount.chars.toLocaleString()} characters">
        {wordCount.words.toLocaleString()} words
      </span>
    {/if}
    <button class="chip" title="Render mode (Ctrl+Shift+M)" onclick={cycleRenderModeFromChip}>
      {MODE_LABELS[renderMode]}
    </button>
    <button class="chip" title="Line endings — click to toggle" onclick={toggleEol}>
      {eol.toUpperCase()}
    </button>
    <div class="chip-wrap">
      <button class="chip" title="Indentation" onclick={() => (indentMenuOpen = !indentMenuOpen)}>
        {indentLabel}
      </button>
      {#if indentMenuOpen}
        <button class="menu-backdrop" aria-label="Close" onclick={() => (indentMenuOpen = false)}
        ></button>
        <div class="chip-menu" role="menu">
          <button role="menuitemradio" aria-checked={indent.style === "spaces" && indent.width === 2}
            onclick={() => chooseIndent({ style: "spaces", width: 2 })}>Spaces: 2</button>
          <button role="menuitemradio" aria-checked={indent.style === "spaces" && indent.width === 4}
            onclick={() => chooseIndent({ style: "spaces", width: 4 })}>Spaces: 4</button>
          <button role="menuitemradio" aria-checked={indent.style === "tab"}
            onclick={() => chooseIndent({ style: "tab", width: indent.width })}>Tabs</button>
          <hr />
          <button role="menuitem" onclick={convertIndent}>Convert existing indentation</button>
        </div>
      {/if}
    </div>
  </div>
  {/if}

  {#if confirmOpen}
    <div class="modal-backdrop" role="presentation">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1" use:trapFocus>
        <h2 id="confirm-title">Unsaved changes</h2>
        <p>"{fileName}" has unsaved changes. Save them first?</p>
        <div class="modal-actions">
          <button class="btn-primary" onclick={() => resolveConfirm("save")}>Save</button>
          <button class="btn-danger" onclick={() => resolveConfirm("discard")}>Don't save</button>
          <button onclick={() => resolveConfirm("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}

  {#if conflictOpen}
    <div class="modal-backdrop" role="presentation">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="conflict-title" tabindex="-1" use:trapFocus>
        <h2 id="conflict-title">File changed on disk</h2>
        <p>
          "{fileName}" was modified by another program since you opened it. Saving now would
          overwrite that change.
        </p>
        <div class="modal-actions">
          <button class="btn-primary" onclick={() => resolveConflictModal("overwrite")}>Overwrite</button>
          <button onclick={() => resolveConflictModal("save-copy")}>Save a copy</button>
          <button class="btn-danger" onclick={() => resolveConflictModal("reload")}>Reload theirs</button>
          <button onclick={() => resolveConflictModal("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}

</div>

<style>
  .app {
    position: relative;
    /* Shrink above the soft keyboard. `--kb-inset` is pushed in natively by
       MainActivity.kt from WindowInsets.ime() — on Android the web layer gets NO other
       signal that the keyboard exists (measured on a Pixel 9 Pro: innerHeight and
       visualViewport.height both stay at their full-screen value, and neither
       interactive-widget=resizes-content nor windowSoftInputMode=adjustResize changes
       that on a targetSdk 35+ edge-to-edge app). Shrinking here is what gives CodeMirror
       a correct visible height, so its own caret scrollIntoView keeps the cursor above
       the keyboard. Unset everywhere else (desktop, web) -> 0 -> plain 100dvh. */
    height: calc(100dvh - var(--kb-inset, 0px));
    width: 100%;
  }

  .statusbar {
    position: fixed;
    /* ADDITIVE, not max(): clear the gesture bar / home indicator and THEN add the
       base margin. max() resolves to exactly the inset on a phone, parking the chips
       right on top of the gesture pill (M6 S1 on-device). env() is 0 on desktop, so
       this degrades to the plain base px. */
    bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
    right: calc(env(safe-area-inset-right, 0px) + 14px);
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    pointer-events: none; /* gaps pass clicks through to the editor */
  }
  .status-name {
    color: var(--muted);
    padding: 2px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-raised) 78%, transparent);
    user-select: none;
  }
  /* Inert on desktop — otherwise it would still be a flex item and add a `gap`. */
  .status-row-break {
    display: none;
  }
  .chip {
    pointer-events: auto;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-raised) 88%, transparent);
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .chip:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  /* read-only status (e.g. word count): same look, not clickable */
  .chip-readonly {
    cursor: default;
  }
  .chip-readonly:hover {
    color: var(--muted);
    border-color: var(--border);
  }
  .chip-wrap {
    position: relative;
    pointer-events: auto;
  }
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 18;
    border: none;
    background: transparent;
    cursor: default;
  }
  .chip-menu {
    position: absolute;
    bottom: 28px;
    right: 0;
    z-index: 19;
    min-width: 200px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-raised);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }
  .chip-menu button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .chip-menu button:hover {
    background: var(--bg-hover);
  }
  .chip-menu button[aria-checked="true"]::after {
    content: "✓";
    color: var(--accent);
  }
  .chip-menu hr {
    margin: 6px 4px;
    border: none;
    border-top: 1px solid var(--border);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
  }
  .modal {
    width: min(420px, calc(100vw - 48px));
    padding: 20px 22px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-raised);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
  }
  .modal h2 {
    margin: 0 0 8px;
    font-size: 16px;
  }
  .modal p {
    margin: 0 0 18px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .modal-actions button {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  .modal-actions button:hover {
    background: var(--bg-hover);
  }
  .modal-actions .btn-primary {
    border-color: var(--accent);
    background: var(--accent);
    color: #10131c;
    font-weight: 600;
  }
  .modal-actions .btn-danger {
    border-color: transparent;
    color: #ff8b8b;
  }

  /* Stop pull-to-refresh / scroll-chaining on the editor scroller on touch; a no-op
     on desktop where there's no page to chain to (M6 REQ-MOBILE-2). */
  :global(.cm-scroller) {
    overscroll-behavior: none;
  }

  /* Phone (M6 REQ-MOBILE-2): keep the bottom status chips on-screen (wrap + inset,
     truncate a long filename) and make the tappable chips comfortable to touch. The
     editor column already clings to the window width on narrow screens (REQ-ZOOM-3),
     so it's full-width here without extra rules. */
  @media (max-width: 600px) {
    .statusbar {
      left: calc(env(safe-area-inset-left, 0px) + 8px);
      max-width: calc(100vw - 16px);
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 5px;
    }
    /* The filename gets its OWN row above the chips, via the .status-row-break sibling.
       Two reasons: it is not a .chip, so it never picks up the chips' min-height and
       sitting inline beside them read as a mismatched pill; and a real filename is far
       longer than the 45vw it used to be squeezed into. On its own row it keeps its
       natural pill height/width and can use the full width before ellipsing. */
    .status-row-break {
      display: block;
      flex-basis: 100%;
      height: 0;
      margin: 0;
    }
    .status-name {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chip {
      min-height: 34px;
      padding: 6px 12px;
      display: inline-flex;
      align-items: center;
      font-size: 13px;
    }
    .chip-menu {
      max-height: calc(100dvh - 120px);
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .chip-menu button {
      min-height: 44px;
      padding: 10px 12px;
      font-size: 14px;
    }
    .modal {
      max-width: calc(100vw - 24px);
    }
  }

  /* Safe-area clearance is a property of the DEVICE (it has system bars), not of the
     viewport width — so it must NOT live in the max-width breakpoint above. A phone
     rotated to landscape is ~952px wide: the width query stops matching, but the
     gesture nav bar is still there. Keying this on `pointer: coarse` keeps the floor in
     both orientations while leaving mouse-driven desktop (env()=0 anyway) untouched.
     FLOOR rationale, measured on a Pixel 9 Pro / Android 16 WebView (M6 S1/S2):
     env(safe-area-inset-top) correctly reports 52px but env(safe-area-inset-BOTTOM)
     reports 0px despite a gesture bar being present, so additive math alone leaves the
     chips under the pill. max() guarantees ~24dp of clearance while still deferring to
     env() where it reports a larger real inset. (General fallback = M6 risk #5.) */
  @media (pointer: coarse) {
    .statusbar {
      /* Three candidates, no branching needed — whichever is largest wins:
           32px .......................... the gesture-bar floor (env bottom lies; see above)
           env(bottom) + 8 ............... a device that DOES report a real bottom inset
           --kb-inset + 8 ................ sit just above the soft keyboard when it is up
         The statusbar is position:fixed, so shrinking .app does NOT move it — it has to
         account for the keyboard itself. With the keyboard closed --kb-inset is 0 and the
         third candidate collapses to 8px, leaving the floor in charge. */
      bottom: max(
        32px,
        calc(env(safe-area-inset-bottom, 0px) + 8px),
        calc(var(--kb-inset, 0px) + 8px)
      );
    }
    /* Scroll clamping belongs here too — a landscape phone is short, so this is exactly
       when a popover most needs to stay on-screen. Subtract the real insets rather than
       a flat constant. */
    .chip-menu {
      max-height: calc(
        100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 120px
      );
      overflow-y: auto;
      overscroll-behavior: contain;
    }
  }
</style>
