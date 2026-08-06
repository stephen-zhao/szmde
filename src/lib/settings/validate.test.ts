import { describe, expect, it } from "vitest";
import { validate, validatePartial } from "./validate";
import { DEFAULTS, SCHEMA_VERSION } from "./schema";

describe("[REQ-SET-2] validate — coerce arbitrary JSON to valid Settings", () => {
  it("returns full DEFAULTS for non-object / garbage input", () => {
    expect(validate(null)).toEqual(DEFAULTS);
    expect(validate("nope")).toEqual(DEFAULTS);
    expect(validate(42)).toEqual(DEFAULTS);
    expect(validate([1, 2])).toEqual(DEFAULTS);
  });

  it("keeps valid known values and stamps the current version", () => {
    const out = validate({
      appearance: { theme: "light", fontSize: 20, lineWidth: 900 },
      editor: { renderMode: "markers-syntax", indentWidth: 4, defaultEol: "crlf" },
    });
    expect(out.version).toBe(SCHEMA_VERSION);
    expect(out.appearance.theme).toBe("light");
    expect(out.appearance.fontSize).toBe(20);
    expect(out.appearance.lineWidth).toBe(900);
    expect(out.editor.renderMode).toBe("markers-syntax");
    expect(out.editor.indentWidth).toBe(4);
    expect(out.editor.defaultEol).toBe("crlf");
  });

  it("drops values that fail their guard, falling back to the default", () => {
    const out = validate({
      appearance: { theme: "neon", fontSize: 9999, accentColor: "blue", lineWidth: 50 },
      editor: { renderMode: "bogus", indentWidth: 0, autosaveIntervalMs: 10 },
    });
    expect(out.appearance.theme).toBe(DEFAULTS.appearance.theme);
    expect(out.appearance.fontSize).toBe(DEFAULTS.appearance.fontSize);
    expect(out.appearance.accentColor).toBe(DEFAULTS.appearance.accentColor);
    expect(out.appearance.lineWidth).toBe(DEFAULTS.appearance.lineWidth); // 50 < min → default
    expect(out.editor.renderMode).toBe(DEFAULTS.editor.renderMode);
    expect(out.editor.indentWidth).toBe(DEFAULTS.editor.indentWidth);
    expect(out.editor.autosaveIntervalMs).toBe(DEFAULTS.editor.autosaveIntervalMs);
  });

  it("accepts a valid hex accent color but rejects a bad one", () => {
    expect(validate({ appearance: { accentColor: "#abc" } }).appearance.accentColor).toBe("#abc");
    expect(validate({ appearance: { accentColor: "#12345" } }).appearance.accentColor).toBe(
      DEFAULTS.appearance.accentColor,
    );
  });

  it("drops unknown keys and unknown groups entirely", () => {
    const out = validate({ appearance: { bogusKey: 1 }, nonsense: { a: 1 } });
    expect((out.appearance as unknown as Record<string, unknown>).bogusKey).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).nonsense).toBeUndefined();
  });

  it("whitelists storage.accounts fields so secrets can't leak in", () => {
    const out = validate({
      storage: {
        defaultProvider: "gdrive",
        accounts: [
          { id: "a1", provider: "gdrive", label: "Work", secretToken: "leak-me" },
          { id: 1, provider: "x", label: "bad-id" }, // wrong shape → dropped
        ],
      },
    });
    expect(out.storage.defaultProvider).toBe("gdrive");
    expect(out.storage.accounts).toEqual([{ id: "a1", provider: "gdrive", label: "Work" }]);
    expect(
      (out.storage.accounts[0] as unknown as Record<string, unknown>).secretToken,
    ).toBeUndefined();
  });

  it("falls back to an empty accounts list when accounts is not an array", () => {
    expect(validate({ storage: { accounts: "nope" } }).storage.accounts).toEqual([]);
  });
});

describe("[REQ-SET-2] validatePartial — thin override tier (no default filling)", () => {
  it("returns only the present, valid keys (no defaults filled in)", () => {
    const out = validatePartial({ editor: { renderMode: "markers-syntax" } });
    expect(out).toEqual({ editor: { renderMode: "markers-syntax" } });
  });

  it("omits groups that are absent or fully invalid", () => {
    expect(validatePartial({ appearance: { theme: "neon" }, editor: { indentWidth: 4 } })).toEqual({
      editor: { indentWidth: 4 },
    });
  });

  it("returns {} for non-object / empty input", () => {
    expect(validatePartial(null)).toEqual({});
    expect(validatePartial({})).toEqual({});
  });

  it("keeps a partial storage tier (provider only)", () => {
    expect(validatePartial({ storage: { defaultProvider: "gdrive" } })).toEqual({
      storage: { defaultProvider: "gdrive" },
    });
  });
});

describe("[REQ-LANE-1] lanes — bespoke lane-model validation", () => {
  it("keeps a valid ordered id list, whitelisting unknown ids and dupes", () => {
    expect(
      validatePartial({ lanes: { order: ["marker", "fold", "fold", "bogus"] } }),
    ).toEqual({ lanes: { order: ["marker", "fold"] } });
  });

  it("drops an order with no known ids (thin partial → no lanes)", () => {
    expect(validatePartial({ lanes: { order: ["nope", 42] } })).toEqual({});
  });

  it("rejects Object.prototype names in order (own-key whitelist, not `in`)", () => {
    // `id in LANE_REGISTRY` would let "toString"/"constructor"/"__proto__" through
    // (they're on the prototype chain); the own-key check drops them, keeping "fold".
    expect(
      validatePartial({ lanes: { order: ["toString", "constructor", "__proto__", "fold"] } }),
    ).toEqual({ lanes: { order: ["fold"] } });
  });

  it("keeps a thin per-lane override (strategy only)", () => {
    expect(validatePartial({ lanes: { byId: { fold: { strategy: "off" } } } })).toEqual({
      lanes: { byId: { fold: { strategy: "off" } } },
    });
  });

  it("coerces a mandatory lane (marker) away from `off` (SPEC §7.6)", () => {
    expect(validate({ lanes: { byId: { marker: { strategy: "off" } } } }).lanes.byId.marker.strategy).toBe(
      "reserved",
    );
    // fold, which is optional, keeps `off`.
    expect(validate({ lanes: { byId: { fold: { strategy: "off" } } } }).lanes.byId.fold.strategy).toBe(
      "off",
    );
  });

  it("skips a non-object lane entry and an invalid strategy/z-order", () => {
    // fold is not an object → skipped; marker keeps only its valid drawer strategy
    // (the non-integer drawerHeight is dropped).
    expect(
      validatePartial({
        lanes: { byId: { fold: "x", marker: { strategy: "drawer", drawerHeight: 1.5 } } },
      }),
    ).toEqual({ lanes: { byId: { marker: { strategy: "drawer" } } } });
  });

  it("drops a lane whose every field is invalid (empty → no lanes)", () => {
    expect(validatePartial({ lanes: { byId: { fold: { strategy: "bogus", drawerHeight: 999 } } } })).toEqual(
      {},
    );
  });

  it("keeps an in-range integer drawerHeight, dropping out-of-range / non-int", () => {
    expect(validatePartial({ lanes: { byId: { fold: { drawerHeight: 5 } } } })).toEqual({
      lanes: { byId: { fold: { drawerHeight: 5 } } },
    });
    expect(validatePartial({ lanes: { byId: { fold: { drawerHeight: 100 } } } })).toEqual({});
    expect(validatePartial({ lanes: { byId: { fold: { drawerHeight: -1 } } } })).toEqual({});
  });

  it("falls back to DEFAULTS.lanes when lanes is absent or not an object", () => {
    expect(validate({ lanes: "nope" }).lanes).toEqual(DEFAULTS.lanes);
    expect(validate({}).lanes).toEqual(DEFAULTS.lanes);
  });
});
