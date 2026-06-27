import {
  DEFAULTS,
  GUARDS,
  SCHEMA_VERSION,
  type Settings,
  type StorageAccount,
  type StorageSettings,
} from "./schema";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A validated group: start from defaults, keep only known leaves whose value
 *  passes its guard; everything else (unknown keys, bad values) falls back. */
function validateGroup<T extends object>(
  raw: unknown,
  defaults: T,
  guards: Record<string, (v: unknown) => boolean>,
): T {
  const out = { ...defaults } as Record<string, unknown>;
  if (isObj(raw)) {
    for (const key of Object.keys(guards)) {
      if (guards[key](raw[key])) out[key] = raw[key];
    }
  }
  return out as T;
}

/** storage needs bespoke handling: accounts[] is field-whitelisted so a
 *  hand-edited file can never smuggle secret fields into effective settings. */
function validateStorage(raw: unknown): StorageSettings {
  const out: StorageSettings = { defaultProvider: DEFAULTS.storage.defaultProvider, accounts: [] };
  if (isObj(raw)) {
    if (typeof raw.defaultProvider === "string" && raw.defaultProvider.length > 0) {
      out.defaultProvider = raw.defaultProvider;
    }
    if (Array.isArray(raw.accounts)) {
      out.accounts = raw.accounts.filter(isAccountShape).map((a) => ({
        id: a.id,
        provider: a.provider,
        label: a.label,
      }));
    }
  }
  return out;
}

function isAccountShape(a: unknown): a is StorageAccount {
  return (
    isObj(a) &&
    typeof a.id === "string" &&
    typeof a.provider === "string" &&
    typeof a.label === "string"
  );
}

/**
 * Coerce arbitrary parsed JSON into a valid, complete `Settings`: every unknown
 * or invalid key falls back to its default. Never throws. The result is always a
 * full Settings stamped at the current schema version (migrate.ts handles
 * cross-version reshaping before this runs).
 */
export function validate(raw: unknown): Settings {
  const r = isObj(raw) ? raw : {};
  return {
    version: SCHEMA_VERSION,
    appearance: validateGroup(r.appearance, DEFAULTS.appearance, GUARDS.appearance),
    editor: validateGroup(r.editor, DEFAULTS.editor, GUARDS.editor),
    markdown: validateGroup(r.markdown, DEFAULTS.markdown, GUARDS.markdown),
    storage: validateStorage(r.storage),
  };
}
