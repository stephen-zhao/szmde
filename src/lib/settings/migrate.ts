import { SCHEMA_VERSION } from "./schema";

export type Migration = (o: Record<string, unknown>) => Record<string, unknown>;

/**
 * Forward migrations indexed by from-version: `MIGRATIONS[n]` upgrades a v`n`
 * blob to v`n+1`. v1 is the baseline, so the list is empty today; the machinery
 * (and its tests) are in place for the first real `v1 → v2` bump.
 */
export const MIGRATIONS: Migration[] = [];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Bring an arbitrary parsed blob up to the target schema version by applying the
 * ordered migration steps, then stamp the version. Pure (no clock/random) and
 * total (a non-object becomes an empty object first). `migrations`/`target` are
 * injectable for testing the step machinery without waiting for a real v2.
 */
export function migrate(
  raw: unknown,
  migrations: Migration[] = MIGRATIONS,
  target = SCHEMA_VERSION,
): Record<string, unknown> {
  let obj: Record<string, unknown> = isObj(raw) ? { ...raw } : {};
  let from = typeof obj.version === "number" && Number.isFinite(obj.version) ? obj.version : 0;
  if (from < 0) from = 0;
  for (let v = from; v < target; v++) {
    const step = migrations[v];
    if (step) obj = step(obj);
  }
  obj.version = target;
  return obj;
}
