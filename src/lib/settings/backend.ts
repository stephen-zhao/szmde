/**
 * The storage seam for settings: raw-string I/O only, no schema knowledge. This
 * keeps all parse/merge/validate/migrate logic in the pure core + the service,
 * and lets every unit test run with an in-memory double (no Tauri imported).
 *
 * Contract: a read returns `null` ONLY for a genuinely absent file (a normal
 * first run) and REJECTS only on a real I/O error — so the service can
 * default-and-continue on the former while surfacing the latter.
 */
export interface SettingsBackend {
  /** system.json text (shipped/admin defaults), or null if not present. */
  readSystem(): Promise<string | null>;
  /** user.json text (per-user overrides), or null on first run. */
  readUser(): Promise<string | null>;
  /** Persist user.json text atomically. system.json is never written. */
  writeUser(text: string): Promise<void>;
}

/** Test double + web/no-Tauri fallback. Records writes so persistence can be
 *  asserted; failure flags exercise the service's I/O-error branches. */
export class InMemorySettingsBackend implements SettingsBackend {
  system: string | null;
  user: string | null;
  lastWritten: string | null = null;
  writeCount = 0;
  failReadUser = false;
  failWriteUser = false;

  constructor(seed?: { system?: string | null; user?: string | null }) {
    this.system = seed?.system ?? null;
    this.user = seed?.user ?? null;
  }

  async readSystem(): Promise<string | null> {
    return this.system;
  }
  async readUser(): Promise<string | null> {
    if (this.failReadUser) throw new Error("simulated read I/O error");
    return this.user;
  }
  async writeUser(text: string): Promise<void> {
    if (this.failWriteUser) throw new Error("simulated write I/O error");
    this.user = text;
    this.lastWritten = text;
    this.writeCount++;
  }
}
