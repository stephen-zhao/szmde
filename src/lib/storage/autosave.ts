/**
 * Debounced autosave (REQ-SAVE-2; SPEC §8 `editor.autosave` /
 * `editor.autosaveIntervalMs`). Each edit calls `notifyDirty()`; after
 * `intervalMs` of quiet the injected `save()` runs, so a burst of edits coalesces
 * into a single save. Disabling cancels any pending save; `flush()` forces an
 * immediate one (e.g. before closing). Uses the ambient timer functions, so unit
 * tests drive it deterministically with vitest fake timers.
 */
export interface AutosaveOptions {
  /** Persist the current document. The return value is ignored and a rejection
   *  is swallowed, so a transient failure never wedges future autosaves. */
  save: () => unknown | Promise<unknown>;
  intervalMs: number;
  enabled: boolean;
}

export class AutosaveScheduler {
  #save: AutosaveOptions["save"];
  #intervalMs: number;
  #enabled: boolean;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #saving = false;

  constructor(opts: AutosaveOptions) {
    this.#save = opts.save;
    this.#intervalMs = opts.intervalMs;
    this.#enabled = opts.enabled;
  }

  /** Note that the document changed; (re)arms the debounce when enabled. */
  notifyDirty(): void {
    if (!this.#enabled) return;
    this.#arm();
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) this.cancel();
  }

  setIntervalMs(ms: number): void {
    this.#intervalMs = ms;
  }

  /** Cancel a pending debounce without saving. */
  cancel(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /** Save now, cancelling any pending debounce so we don't double-save. */
  async flush(): Promise<void> {
    this.cancel();
    await this.#run();
  }

  #arm(): void {
    this.cancel();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#run();
    }, this.#intervalMs);
  }

  async #run(): Promise<void> {
    if (this.#saving) return; // never overlap saves (a slow cloud write in flight)
    this.#saving = true;
    try {
      await this.#save();
    } catch {
      // Swallowed: a failed autosave must not wedge later ones. The manual Save
      // path is what surfaces errors to the user.
    } finally {
      this.#saving = false;
    }
  }
}
