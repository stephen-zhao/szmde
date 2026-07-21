import { describe, it, expect } from "vitest";
import { DEFAULT_TYPEWRITER_ANCHOR, typewriterScrollTop } from "./typewriter";

/** A measured 800px-tall viewport in the middle of a long document. */
const base = {
  scrollTop: 1000,
  viewportHeight: 800,
  scrollHeight: 10000,
  lineTop: 700,
  lineBottom: 720,
  anchor: DEFAULT_TYPEWRITER_ANCHOR,
};

describe("[REQ-SCROLL-1] typewriterScrollTop", () => {
  it("rests the active line on the anchor — two thirds down by default", () => {
    // Centring put the line uncomfortably high once the keyboard was up (user testing on
    // a phone), so the resting point is 2/3 down, not 1/2.
    expect(DEFAULT_TYPEWRITER_ANCHOR).toBeCloseTo(2 / 3, 5);
    // line centre 710, anchor 800 * 2/3 = 533.33 -> scroll a further 176.67px.
    expect(typewriterScrollTop(base)).toBe(1177);
  });

  it("honours a custom anchor", () => {
    // 0.5 restores classic centring; 0.25 keeps the line high; 0.9 parks it near the
    // bottom — and at 0.9 the default geometry's line (centre 710) is already ABOVE the
    // anchor at 720, so nothing moves. Push it lower to see the 0.9 resting point.
    expect(typewriterScrollTop({ ...base, anchor: 0.5 })).toBe(1310);
    expect(typewriterScrollTop({ ...base, anchor: 0.25 })).toBe(1510);
    expect(typewriterScrollTop({ ...base, anchor: 0.9 })).toBeNull();
    expect(typewriterScrollTop({ ...base, anchor: 0.9, lineTop: 900, lineBottom: 920 })).toBe(1190);
  });

  it("falls back to the default anchor for a nonsensical one", () => {
    // Settings validation already bounds it; this is the in-code backstop, and 0 or a
    // negative anchor would mean "rest at/above the top edge", which cannot be satisfied.
    const expected = typewriterScrollTop(base);
    for (const anchor of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(typewriterScrollTop({ ...base, anchor })).toBe(expected);
    }
  });

  it("brings back a line that has already fallen off the bottom of the viewport", () => {
    // Typing at the bottom edge moves the caret below the visible box before the
    // measure phase runs; it is off-screen, not merely low in the viewport.
    expect(typewriterScrollTop({ ...base, lineTop: 900, lineBottom: 920 })).toBe(1377);
  });

  it("returns null for a line at or above the anchor, leaving CodeMirror's minimal scrolling", () => {
    // The invariant is one-directional: the active line never rests BELOW the anchor.
    // Above it we must not scroll at all, or moving the cursor up would yank the
    // document down to re-settle — the "lurch" the requirement rejects.
    expect(typewriterScrollTop({ ...base, lineTop: 523, lineBottom: 543 })).toBeNull(); // on the anchor
    expect(typewriterScrollTop({ ...base, lineTop: 100, lineBottom: 120 })).toBeNull();
    expect(typewriterScrollTop({ ...base, lineTop: -500, lineBottom: -480 })).toBeNull(); // off the top
  });

  it("clamps to the end of the scrollable range instead of over-scrolling", () => {
    // The theme's 40vh bottom padding is what makes settling near the end possible at
    // all; past that limit the line legitimately sits below the anchor.
    const g = { ...base, scrollHeight: 2000 }; // max scrollTop = 1200
    expect(typewriterScrollTop(g)).toBe(1177); // 1176.67 needed, and it fits
    expect(typewriterScrollTop({ ...g, scrollTop: 1150 })).toBe(1200); // 1326.67 wanted -> clamped
  });

  it("returns null when already scrolled to the end, so it never claims a no-op scroll", () => {
    // Returning a number here would tell CodeMirror "handled" and suppress its own
    // scrolling for a scroll we did not actually perform.
    const g = { ...base, scrollHeight: 2000, scrollTop: 1200 }; // already at max
    expect(typewriterScrollTop(g)).toBeNull();
  });

  it("returns null for an unmeasured or nonsensical viewport", () => {
    // .cm-scroller reports 0 before first layout and during some Android IME
    // transitions; acting on that would scroll to an arbitrary position.
    expect(typewriterScrollTop({ ...base, viewportHeight: 0 })).toBeNull();
    expect(typewriterScrollTop({ ...base, viewportHeight: -100 })).toBeNull();
    expect(typewriterScrollTop({ ...base, viewportHeight: Number.NaN })).toBeNull();
    expect(typewriterScrollTop({ ...base, viewportHeight: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("returns null for line coordinates that are not finite numbers", () => {
    expect(typewriterScrollTop({ ...base, lineTop: Number.NaN, lineBottom: 720 })).toBeNull();
    expect(typewriterScrollTop({ ...base, lineBottom: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("returns null for a non-finite scrollTop or scrollHeight", () => {
    expect(typewriterScrollTop({ ...base, scrollTop: Number.NaN })).toBeNull();
    expect(typewriterScrollTop({ ...base, scrollHeight: Number.NaN })).toBeNull();
  });

  it("never returns a scrollTop below 0 or above the scrollable maximum", () => {
    for (const lineTop of [401, 500, 799, 1200, 5000]) {
      for (const scrollHeight of [900, 1600, 10000]) {
        for (const anchor of [0.25, DEFAULT_TYPEWRITER_ANCHOR, 0.95]) {
          const next = typewriterScrollTop({
            ...base,
            lineTop,
            lineBottom: lineTop + 20,
            scrollHeight,
            anchor,
          });
          if (next === null) continue;
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThanOrEqual(scrollHeight - base.viewportHeight);
        }
      }
    }
  });

  it("anchors against the SHRUNKEN viewport when the Android keyboard is open", () => {
    // --kb-inset (M6 S3) shrinks .app 952 -> 579 on a Pixel 9 Pro; the anchor must
    // follow, or the line would settle against a viewport that no longer exists.
    // line centre 553.5, anchor 579 * 2/3 = 386 -> +167.5
    const phone = {
      scrollTop: 400,
      viewportHeight: 579,
      scrollHeight: 5000,
      lineTop: 540,
      lineBottom: 567,
      anchor: DEFAULT_TYPEWRITER_ANCHOR,
    };
    expect(typewriterScrollTop(phone)).toBe(568);
  });

  it("returns whole pixels", () => {
    const g = { ...base, lineTop: 701, lineBottom: 722 }; // centre 711.5 -> delta 178.17
    const next = typewriterScrollTop(g);
    expect(Number.isInteger(next)).toBe(true);
    expect(next).toBe(1178);
  });
});
