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
  import { detectEol, fromLf, toLf, type Eol } from "$lib/editor/eol";
  import HamburgerMenu from "$lib/HamburgerMenu.svelte";
  import { settings, initSettings, setSetting, updateSettings } from "$lib/settings/store.svelte";

  let editor: EditorApi | undefined;
  let filePath = $state<string | null>(null);
  let dirty = $state(false);
  let wrapState = $state<WrapState>("on");
  let renderMode = $state<RenderMode>("clean");
  let eol = $state<Eol>("lf");
  let indent = $state<IndentConfig>({ style: "spaces", width: 2 });
  let indentMenuOpen = $state(false);

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
  }

  function cycleRenderMode() {
    editor?.setRenderMode(MODE_ORDER[(MODE_ORDER.indexOf(renderMode) + 1) % MODE_ORDER.length]);
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
    // prompt the user is answering. Such callers simply cancel.
    if (confirmResolve) return Promise.resolve("cancel");
    confirmOpen = true;
    return new Promise<Choice>((resolve) => {
      confirmResolve = resolve;
    });
  }
  function resolveConfirm(choice: Choice) {
    confirmOpen = false;
    confirmResolve?.(choice);
    confirmResolve = null;
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
  async function openPath(path: string) {
    try {
      const raw = await invoke<string>("read_file", { path });
      const detected = detectEol(raw);
      eol = detected === "mixed" ? "lf" : detected; // mixed normalizes to LF on save
      editor?.setContent(toLf(raw)); // the editor buffer is always LF
      filePath = path;
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
    dirty = false;
    eol = settings.value.editor.defaultEol; // new docs use the persisted default (SPEC §4.4)
    editor?.focus();
  }

  async function doOpen() {
    if (!(await guardUnsaved())) return;
    const selected = await openDialog({ multiple: false, filters: MD_FILTERS });
    if (typeof selected === "string") await openPath(selected);
  }

  async function doSave(): Promise<boolean> {
    if (!filePath) return doSaveAs();
    try {
      await invoke("write_file", {
        path: filePath,
        content: fromLf(editor?.getContent() ?? "", eol),
      });
      dirty = false;
      return true;
    } catch (e) {
      await message(`Couldn't save the file:\n${filePath}\n\n${e}`, {
        title: "Save failed",
        kind: "error",
      });
      return false;
    }
  }

  async function doSaveAs(): Promise<boolean> {
    const path = await saveDialog({
      filters: MD_FILTERS,
      defaultPath: filePath ?? "Untitled.md",
    });
    if (!path) return false;
    try {
      await invoke("write_file", { path, content: fromLf(editor?.getContent() ?? "", eol) });
      filePath = path;
      dirty = false;
      return true;
    } catch (e) {
      await message(`Couldn't save the file:\n${path}\n\n${e}`, {
        title: "Save failed",
        kind: "error",
      });
      return false;
    }
  }

  async function doExit() {
    if (!(await guardUnsaved())) return;
    await getCurrentWindow().destroy();
  }

  // --- Shortcuts --------------------------------------------------------------
  function onKeydown(e: KeyboardEvent) {
    if (confirmOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        resolveConfirm("cancel");
      } else if (e.key === "Enter") {
        e.preventDefault();
        resolveConfirm("save");
      }
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
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

    // Load persisted settings (§8), then seed the editor + new-doc EOL from them.
    // Runs concurrently with get_launch_file; an opened file's detected EOL still
    // wins (openPath overwrites `eol`), so defaultEol only governs new docs.
    initSettings().then((eff) => {
      if (!filePath) eol = eff.editor.defaultEol;
      seedEditorFromSettings();
    });

    return () => {
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
    {wrapState}
    ontogglewrap={toggleCodeWrap}
    {renderMode}
    onsetrendermode={setRenderMode}
  />

  <Editor
    onready={(api) => {
      editor = api;
      seedEditorFromSettings();
    }}
    onchange={() => (dirty = true)}
    onwrapstate={(s) => (wrapState = s)}
    onrendermode={(m) => {
      renderMode = m;
      setSetting("editor.renderMode", m); // persist (no-op-guarded at boot)
    }}
    onindentstate={(c) => {
      indent = c;
      updateSettings({ editor: { indentStyle: c.style, indentWidth: c.width } });
    }}
  />

  <!-- Bottom-right status bar (§7.1): filename + click-to-edit chips. Tiny and
       low-contrast to honor the blank-canvas ethos (requirement 9). Hidden when
       appearance.showStatusWidgets is off (§7.1 / settings §8). -->
  {#if settings.value.appearance.showStatusWidgets}
  <div class="statusbar">
    <span class="status-name">{fileName}{dirty ? " •" : ""}</span>
    <button class="chip" title="Render mode (Ctrl+Shift+M)" onclick={cycleRenderMode}>
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
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
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
</div>

<style>
  .app {
    position: relative;
    height: 100dvh;
    width: 100%;
  }

  .statusbar {
    position: fixed;
    bottom: 8px;
    right: 14px;
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
  .chip {
    pointer-events: auto;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-raised) 88%, transparent);
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
  }
  .chip:hover {
    color: var(--text);
    border-color: var(--accent);
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
</style>
