import { DEFAULTS, SCHEMA_VERSION, type DeepPartial, type Settings } from "./schema";
import { deepMerge } from "./merge";
import { validate, validatePartial } from "./validate";
import { migrate } from "./migrate";
import type { SettingsBackend } from "./backend";

type Listener = (s: Settings) => void;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
/** A fully independent, deep-frozen snapshot (no shared refs with DEFAULTS). */
const snapshot = (s: Settings): Settings => deepFreeze(structuredClone(s));

/**
 * Framework-agnostic owner of the effective settings. Two override tiers
 * (system + user) are validated to thin partials and layered over DEFAULTS; the
 * user tier is the only thing `update()` mutates and persists. Resilient: any
 * missing file, corrupt JSON, I/O error, or invalid key degrades to a valid
 * effective object and never throws (errors go to the injected `onError`).
 *
 * The Svelte adapter (store.svelte.ts) is a thin reactive wrapper over this; all
 * the load-bearing logic lives here so it's 100%-unit-testable via an in-memory
 * backend with no Tauri.
 */
export class SettingsService {
  private systemPartial: DeepPartial<Settings> = {};
  private userOverrides: DeepPartial<Settings> = {};
  private effective: Settings = snapshot(DEFAULTS);
  private listeners = new Set<Listener>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private backend: SettingsBackend,
    private onError: (e: unknown) => void = () => {},
  ) {}

  /** Read both tiers, recompute effective. Idempotent; never throws. */
  async load(): Promise<Settings> {
    this.systemPartial = await this.readPartial(() => this.backend.readSystem());
    this.userOverrides = await this.readPartial(() => this.backend.readUser());
    this.recompute();
    return this.effective;
  }

  private async readPartial(read: () => Promise<string | null>): Promise<DeepPartial<Settings>> {
    let text: string | null;
    try {
      text = await read();
    } catch (e) {
      this.onError(e); // genuine I/O error → degrade to no overrides
      return {};
    }
    if (text == null) return {}; // absent file = normal first run
    try {
      return validatePartial(migrate(JSON.parse(text)));
    } catch (e) {
      this.onError(e); // corrupt JSON → degrade
      return {};
    }
  }

  private computeEffective(user: DeepPartial<Settings>): Settings {
    return validate(deepMerge(deepMerge(DEFAULTS, this.systemPartial), user));
  }

  private recompute(): void {
    this.effective = snapshot(this.computeEffective(this.userOverrides));
  }

  /** Current effective settings (deep-frozen snapshot; DEFAULTS before load). */
  get(): Settings {
    return this.effective;
  }

  /** Dotted-path reader, e.g. getValue("editor.indentWidth"). */
  getValue<T = unknown>(path: string): T {
    return path
      .split(".")
      .reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), this.effective) as T;
  }

  /** Typed setter over update(): set("appearance.theme", "light"). */
  set(path: string, value: unknown): Settings {
    const parts = path.split(".");
    const patch: Record<string, unknown> = {};
    let cur = patch;
    parts.forEach((k, i) => {
      if (i === parts.length - 1) cur[k] = value;
      else cur = cur[k] = {};
    });
    return this.update(patch as DeepPartial<Settings>);
  }

  /**
   * Merge a deep-partial patch into the USER tier, re-validate it, recompute
   * effective, and (if effective actually changed) notify + persist. The
   * no-op guard means boot-time re-seeding with current values never triggers a
   * redundant write, closing the editor↔settings write-loop.
   */
  update(patch: DeepPartial<Settings>): Settings {
    const nextUser = validatePartial(deepMerge(this.userOverrides, patch));
    const next = this.computeEffective(nextUser);
    if (JSON.stringify(next) === JSON.stringify(this.effective)) {
      return this.effective; // nothing changed → no notify, no persist
    }
    this.userOverrides = nextUser;
    this.effective = snapshot(next);
    this.notify();
    this.persist();
    return this.effective;
  }

  private persist(): void {
    const text = JSON.stringify({ version: SCHEMA_VERSION, ...this.userOverrides });
    // Serialize writes: chain off the prior persist so a burst (e.g. fast
    // scroll-zoom firing many setSetting calls) never has two writeUser calls in
    // flight at once — they'd otherwise race on the shared temp file and could
    // lose the last update. Writes apply in order; the final value wins.
    this.pending = this.pending
      .catch(() => {}) // a prior failure shouldn't block later writes
      .then(() => this.backend.writeUser(text))
      .catch((e) => this.onError(e));
  }

  /** Await any in-flight persist (clean shutdown / deterministic tests). */
  flush(): Promise<void> {
    return this.pending;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.effective);
  }
}
