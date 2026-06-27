import { StorageError, type StorageProvider } from "./provider";

/**
 * Resolves a provider id → its StorageProvider instance, and tracks the default
 * (seeded from settings `storage.defaultProvider`, SPEC §8). The shell asks the
 * registry for a provider instead of hard-coding `LocalProvider`, so the cloud
 * backends (S7/S8) slot in without touching the open/save call sites.
 */
export class ProviderRegistry {
  #providers = new Map<string, StorageProvider>();
  #defaultId: string;

  constructor(providers: StorageProvider[], defaultId?: string) {
    for (const p of providers) this.#providers.set(p.id, p);
    // Fall back to the first registered provider when no default is given.
    this.#defaultId = defaultId ?? providers[0]?.id ?? "";
  }

  /** The provider for `id`, or throws if none is registered under it. */
  get(id: string): StorageProvider {
    const p = this.#providers.get(id);
    if (!p) throw new StorageError("io", `unknown storage provider: ${id}`);
    return p;
  }

  /** The default provider (settings `storage.defaultProvider`). */
  get default(): StorageProvider {
    return this.get(this.#defaultId);
  }
}
