import { SCHEMA_VERSION } from "./schema";

export type Migration = (o: Record<string, unknown>) => Record<string, unknown>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// v1 stored appearance.lineWidth as an enum; v2 stores px (REQ-ZOOM-3).
const LEGACY_LINE_WIDTH_PX: Record<string, number> = { narrow: 640, medium: 740, wide: 880 };

/**
 * Forward migrations indexed by from-version: `MIGRATIONS[n]` upgrades a v`n` blob
 * to v`n+1` (so index 0 = v0→v1, index 1 = v1→v2, …). Sparse is fine — the runner
 * skips missing steps.
 */
export const MIGRATIONS: Migration[] = [];

// v1 → v2: appearance.lineWidth enum → px number.
MIGRATIONS[1] = (o) => {
  const a = o.appearance;
  if (isObj(a) && typeof a.lineWidth === "string") {
    return { ...o, appearance: { ...a, lineWidth: LEGACY_LINE_WIDTH_PX[a.lineWidth] ?? 740 } };
  }
  return o;
};

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
