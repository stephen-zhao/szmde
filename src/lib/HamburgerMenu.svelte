<script lang="ts">
  import type { WrapState } from "$lib/editor/setup";
  import { MODE_ORDER, MODE_LABELS, type RenderMode } from "$lib/editor/render-mode";
  import TableSizePicker from "$lib/TableSizePicker.svelte";

  // The only persistent chrome in szmde (SPEC §7 / §9): a top-left hamburger.
  let {
    onnew,
    onopen,
    onsave,
    onsaveas,
    onexit,
    onopendrive,
    onconnectdrive,
    ondisconnectdrive,
    driveConnected,
    wrapState,
    ontogglewrap,
    renderMode,
    onsetrendermode,
    oninserttable,
  }: {
    onnew: () => void;
    onopen: () => void;
    onsave: () => void;
    onsaveas: () => void;
    onexit: () => void;
    onopendrive: () => void;
    onconnectdrive: () => void;
    ondisconnectdrive: () => void;
    driveConnected: boolean;
    wrapState: WrapState;
    ontogglewrap: () => void;
    renderMode: RenderMode;
    onsetrendermode: (mode: RenderMode) => void;
    oninserttable: (rows: number, cols: number) => void;
  } = $props();

  let open = $state(false);
  let tablePickerOpen = $state(false);

  function run(fn: () => void) {
    open = false;
    fn();
  }

  function closeMenu() {
    open = false;
    tablePickerOpen = false;
  }
</script>

<div class="menu-root">
  <button
    class="hamburger"
    aria-label="Menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M3 6h18M3 12h18M3 18h18"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  </button>

  {#if open}
    <!-- click-away backdrop -->
    <button
      class="backdrop"
      aria-label="Close menu"
      onclick={closeMenu}
    ></button>

    <div class="dropdown" role="menu">
      <button role="menuitem" onclick={() => run(onnew)}>
        New <span class="kbd">Ctrl+N</span>
      </button>
      <button role="menuitem" onclick={() => run(onopen)}>
        Open… <span class="kbd">Ctrl+O</span>
      </button>
      <button role="menuitem" onclick={() => run(onsave)}>
        Save <span class="kbd">Ctrl+S</span>
      </button>
      <button role="menuitem" onclick={() => run(onsaveas)}>
        Save As… <span class="kbd">Ctrl+Shift+S</span>
      </button>
      <hr />
      <div class="section-label">Storage</div>
      <button role="menuitem" onclick={() => run(onopendrive)}>Open from Google Drive…</button>
      {#if driveConnected}
        <button role="menuitem" onclick={() => run(ondisconnectdrive)}>Disconnect Google Drive</button>
      {:else}
        <button role="menuitem" onclick={() => run(onconnectdrive)}>Connect Google Drive…</button>
      {/if}
      <hr />
      <div class="section-label">Render mode <span class="kbd">Ctrl+Shift+M</span></div>
      {#each MODE_ORDER as mode (mode)}
        <button
          role="menuitemradio"
          aria-checked={renderMode === mode}
          onclick={() => onsetrendermode(mode)}
        >
          {MODE_LABELS[mode]}
          <span class="check">{renderMode === mode ? "✓" : ""}</span>
        </button>
      {/each}
      <hr />
      <div class="section-label">Insert</div>
      <button
        role="menuitem"
        aria-expanded={tablePickerOpen}
        onclick={() => (tablePickerOpen = !tablePickerOpen)}
      >
        Table… <span class="check">{tablePickerOpen ? "▾" : "▸"}</span>
      </button>
      {#if tablePickerOpen}
        <TableSizePicker
          oninsert={(rows, cols) => {
            closeMenu();
            oninserttable(rows, cols);
          }}
        />
      {/if}
      <hr />
      <button
        role="menuitemcheckbox"
        aria-checked={wrapState === "on" ? "true" : wrapState === "partial" ? "mixed" : "false"}
        title={wrapState === "partial"
          ? "Some blocks overridden — click to wrap all"
          : "Word-wrap all code blocks"}
        onclick={ontogglewrap}
      >
        Wrap code blocks
        <span class="check">{wrapState === "on" ? "✓" : wrapState === "partial" ? "–" : ""}</span>
      </button>
      <hr />
      <button role="menuitem" disabled title="Coming in a later milestone">
        Settings…
      </button>
      <hr />
      <button role="menuitem" onclick={() => run(onexit)}>Exit</button>
    </div>
  {/if}
</div>

<style>
  .menu-root {
    position: fixed;
    /* ADDITIVE, not max(): clear the status bar / cutout and THEN add the design
       margin. max(10px, env()) resolves to exactly the inset on a phone, leaving the
       button flush against the system bar with no breathing room (M6 S1 on-device).
       env() is 0 on desktop (and WebView <M136), so this degrades to a plain 10px. */
    top: calc(env(safe-area-inset-top, 0px) + 10px);
    left: calc(env(safe-area-inset-left, 0px) + 10px);
    z-index: 20;
  }

  .hamburger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    touch-action: manipulation; /* no 300ms double-tap-zoom delay on touch */
    transition: background 0.15s, color 0.15s;
  }
  .hamburger:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    border: none;
    background: transparent;
    cursor: default;
  }

  .dropdown {
    position: absolute;
    top: 42px;
    left: 0;
    z-index: 20;
    min-width: 220px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-raised);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }

  .dropdown button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
  }
  .dropdown button:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .dropdown button:disabled {
    color: var(--muted);
    cursor: default;
  }

  .kbd {
    color: var(--muted);
    font-size: 12px;
  }

  .check {
    color: var(--accent);
    font-size: 13px;
    min-width: 12px;
    text-align: right;
  }

  .section-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 10px 2px;
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  hr {
    margin: 6px 4px;
    border: none;
    border-top: 1px solid var(--border);
  }

  /* Phone (M6 REQ-MOBILE-2): ≥48dp tap targets, a wider menu that can't overflow
     the screen, and a scrollable dropdown so a tall menu stays reachable. */
  @media (max-width: 600px) {
    .menu-root {
      /* Pull further out of the corner. env() only models RECTANGULAR insets — it
         knows nothing about a phone's rounded display corners, so a control sitting
         at the inset origin lands inside the corner arc: clipped-looking and awkward
         to hit one-handed. The extra 6px clears the arc. */
      top: calc(env(safe-area-inset-top, 0px) + 16px);
      left: calc(env(safe-area-inset-left, 0px) + 16px);
    }
    .hamburger {
      /* 48dp — Material's minimum touch target (the m6-plan's "≥48dp" bar). */
      width: 48px;
      height: 48px;
      /* Touch has no hover, so the desktop muted→text hover reveal NEVER fires and
         the icon would stay permanently dim. Render at full contrast by default. */
      color: var(--text);
    }
    .hamburger svg {
      width: 24px;
      height: 24px;
    }
    .dropdown {
      top: 56px;
      min-width: 260px;
      max-width: calc(100vw - 20px);
      max-height: calc(100dvh - 96px);
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .dropdown button {
      min-height: 44px;
      padding: 10px 12px;
      font-size: 15px;
    }
    .section-label {
      font-size: 12px;
      padding: 6px 12px 3px;
    }
  }
</style>
