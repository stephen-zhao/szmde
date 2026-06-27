/** Plain object (not array, not null) — the only thing deepMerge recurses into. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Keys that must never be copied from an untrusted (hand-edited) user.json, to
// avoid prototype pollution when merging.
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Pure recursive merge: plain objects merge key-wise; arrays, scalars, and null
 * in `override` REPLACE the base value; `undefined` in `override` keeps the base.
 * `base` is never mutated. Prototype-polluting keys are skipped.
 *
 * Used both to layer system+user over DEFAULTS and to fold an update patch into
 * the user-override tier.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    if (FORBIDDEN.has(key)) continue;
    out[key] = deepMerge(out[key], override[key]);
  }
  return out as T;
}
