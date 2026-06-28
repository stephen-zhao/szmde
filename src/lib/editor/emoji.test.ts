import { describe, expect, it } from "vitest";
import { EMOJI } from "./emoji-data";

describe("[REQ-EMOJI-1] EMOJI map", () => {
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });

  it("keys are shortcode-safe and values are exactly one grapheme", () => {
    for (const [k, v] of Object.entries(EMOJI)) {
      expect(k, k).toMatch(/^[a-z0-9_+-]+$/);
      expect(v.length, k).toBeGreaterThan(0);
      // one grapheme — allows ZWJ / variation-selector sequences like ❤️ / ⚠️.
      expect([...seg.segment(v)].length, `${k}=${v}`).toBe(1);
    }
  });

  it("includes common shortcodes and aliases", () => {
    expect(EMOJI.rocket).toBe("🚀");
    expect(EMOJI.smile).toBeTruthy();
    expect(EMOJI["+1"]).toBe("👍");
    expect(EMOJI.thumbsup).toBe("👍");
  });
});
