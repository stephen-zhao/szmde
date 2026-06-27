import { describe, expect, it } from "vitest";
import { deepMerge } from "./merge";

describe("[REQ-SET-1] deepMerge — two-tier settings merge", () => {
  it("merges nested plain objects key-wise", () => {
    const base = { a: { x: 1, y: 2 }, b: 3 };
    expect(deepMerge(base, { a: { y: 9 } })).toEqual({ a: { x: 1, y: 9 }, b: 3 });
  });

  it("replaces scalars, arrays, and null wholesale (no array concat)", () => {
    expect(deepMerge({ n: 1 }, { n: 2 })).toEqual({ n: 2 });
    expect(deepMerge({ a: [1, 2, 3] }, { a: [9] })).toEqual({ a: [9] });
    expect(deepMerge({ v: { keep: 1 } }, { v: null })).toEqual({ v: null });
  });

  it("keeps the base value when the override is undefined", () => {
    expect(deepMerge({ a: 1 }, { a: undefined } as Record<string, unknown>)).toEqual({ a: 1 });
    expect(deepMerge(5, undefined)).toBe(5);
  });

  it("adds keys present only in the override", () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("does not mutate the base object", () => {
    const base = { a: { x: 1 } };
    deepMerge(base, { a: { x: 2, y: 3 } });
    expect(base).toEqual({ a: { x: 1 } });
  });

  it("ignores prototype-polluting keys from untrusted input", () => {
    const out = deepMerge({} as Record<string, unknown>, JSON.parse('{"__proto__":{"polluted":1}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
  });
});
