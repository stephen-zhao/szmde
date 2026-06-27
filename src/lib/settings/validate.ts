import {
  DEFAULTS,
  GUARDS,
  SCHEMA_VERSION,
  type DeepPartial,
  type Settings,
  type StorageAccount,
} from "./schema";
import { deepMerge } from "./merge";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isAccountShape(a: unknown): a is StorageAccount {
  return (
    isObj(a) &&
    typeof a.id === "string" &&
    typeof a.provider === "string" &&
    typeof a.label === "string"
  );
}

/** Keep only the present leaves of a group whose value passes its guard. Returns
 *  undefined if nothing survives (so the group is omitted from the partial). */
function partialGroup(
  raw: unknown,
  guards: Record<string, (v: unknown) => boolean>,
): Record<string, unknown> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(guards)) {
    if (guards[key](raw[key])) out[key] = raw[key];
  }
  return Object.keys(out).length ? out : undefined;
}

/** storage is bespoke: accounts[] is field-whitelisted so a hand-edited file can
 *  never smuggle secret fields through. */
function partialStorage(raw: unknown): Record<string, unknown> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, unknown> = {};
  if (typeof raw.defaultProvider === "string" && raw.defaultProvider.length > 0) {
    out.defaultProvider = raw.defaultProvider;
  }
  if (Array.isArray(raw.accounts)) {
    out.accounts = raw.accounts
      .filter(isAccountShape)
      .map((a) => ({ id: a.id, provider: a.provider, label: a.label }));
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Validate WITHOUT filling defaults: returns only the present, valid keys as a
 * DeepPartial. Unknown groups/keys and invalid values are dropped. This is the
 * shape stored per tier (system/user) so each stays a thin override over
 * DEFAULTS, and future DEFAULTS changes still propagate to untouched keys.
 */
export function validatePartial(raw: unknown): DeepPartial<Settings> {
  const r = isObj(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  const appearance = partialGroup(r.appearance, GUARDS.appearance);
  if (appearance) out.appearance = appearance;
  const editor = partialGroup(r.editor, GUARDS.editor);
  if (editor) out.editor = editor;
  const markdown = partialGroup(r.markdown, GUARDS.markdown);
  if (markdown) out.markdown = markdown;
  const storage = partialStorage(r.storage);
  if (storage) out.storage = storage;
  return out as DeepPartial<Settings>;
}

/**
 * Coerce arbitrary parsed JSON into a complete, valid `Settings`: every unknown
 * or invalid key falls back to its default. Never throws. Result is stamped at
 * the current schema version (migrate.ts handles cross-version reshaping first).
 */
export function validate(raw: unknown): Settings {
  return { ...deepMerge(DEFAULTS, validatePartial(raw)), version: SCHEMA_VERSION };
}
