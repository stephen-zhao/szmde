import { describe, expect, it } from "vitest";
import { migrate, type Migration } from "./migrate";
import { SCHEMA_VERSION } from "./schema";

describe("[REQ-SET-2] migrate — version-stamped forward migration", () => {
  it("stamps the current version on a versionless blob", () => {
    expect(migrate({ appearance: {} }).version).toBe(SCHEMA_VERSION);
  });

  it("leaves an already-current blob shape intact (stamped)", () => {
    const out = migrate({ version: SCHEMA_VERSION, editor: { indentWidth: 4 } });
    expect(out.version).toBe(SCHEMA_VERSION);
    expect((out.editor as Record<string, unknown>).indentWidth).toBe(4);
  });

  it("turns a non-object into an empty, current-version object", () => {
    expect(migrate(null)).toEqual({ version: SCHEMA_VERSION });
    expect(migrate("x")).toEqual({ version: SCHEMA_VERSION });
  });

  it("treats a non-numeric or negative version as 0", () => {
    expect(migrate({ version: "huh" }).version).toBe(SCHEMA_VERSION);
    expect(migrate({ version: -5 }).version).toBe(SCHEMA_VERSION);
  });

  it("applies ordered migration steps up to the target (injected)", () => {
    const steps: Migration[] = [
      (o) => ({ ...o, a: 1 }), // v0 -> v1
      (o) => ({ ...o, b: 2 }), // v1 -> v2
    ];
    const out = migrate({ version: 0 }, steps, 2);
    expect(out).toEqual({ version: 2, a: 1, b: 2 });
  });

  it("skips a missing step in the range without crashing", () => {
    const out = migrate({ version: 0 }, [], 1); // no step at index 0
    expect(out).toEqual({ version: 1 });
  });

  it("starts from the blob's version, not 0, when migrating", () => {
    const steps: Migration[] = [
      () => ({ shouldNotRun: true }),
      (o) => ({ ...o, b: 2 }),
    ];
    const out = migrate({ version: 1 }, steps, 2);
    expect(out).toEqual({ version: 2, b: 2 });
  });

  // The real v1 → v2 migration: appearance.lineWidth enum → px (REQ-ZOOM-3).
  const lw = (raw: unknown) =>
    (migrate(raw).appearance as Record<string, unknown> | undefined)?.lineWidth;

  it("[REQ-ZOOM-3] v1 → v2 maps the lineWidth enum to px", () => {
    expect(lw({ version: 1, appearance: { lineWidth: "narrow" } })).toBe(640);
    expect(lw({ version: 1, appearance: { lineWidth: "medium" } })).toBe(740);
    expect(lw({ version: 1, appearance: { lineWidth: "wide" } })).toBe(880);
  });

  it("v1 → v2 maps an unknown lineWidth string to the default px", () => {
    expect(lw({ version: 1, appearance: { lineWidth: "huge" } })).toBe(740);
  });

  it("v1 → v2 leaves an already-numeric lineWidth untouched", () => {
    expect(lw({ version: 1, appearance: { lineWidth: 900 } })).toBe(900);
  });

  it("v1 → v2 is a no-op when appearance is absent", () => {
    expect(migrate({ version: 1 }).version).toBe(SCHEMA_VERSION);
  });
});
