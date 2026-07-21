import { describe, it, expect } from "vitest";
import { typewriterScrollTop } from "./typewriter";

/** A measured 800px-tall viewport in the middle of a long document. */
const base = {
  scrollTop: 1000,
  viewportHeight: 800,
  scrollHeight: 10000,
  lineTop: 700,
  lineBottom: 720,
};

describe("[REQ-SCROLL-1] typewriterScrollTop", () => {
  it("scrolls exactly enough to put the active line on the vertical midpoint", () => {
    // caret centre 710, target centre 400 -> scroll a further 310px.
    expect(typewriterScrollTop(base)).toBe(1310);
  });

  it("centres a line that has already fallen off the bottom of the viewport", () => {
    // Typing at the bottom edge moves the caret below the visible box before the
    // measure phase runs; it is off-screen, not merely low in the viewport.
    expect(typewriterScrollTop({ ...base, lineTop: 900, lineBottom: 920 })).toBe(1510);
  });

  it("returns null for a line at or above the midpoint, leaving CodeMirror's minimal scrolling", () => {
    // The invariant is one-directional: the active line never rests BELOW the centre.
    // Above it we must not scroll at all, or moving the cursor up would yank the
    // document down to re-centre — the "lurch" the requirement rejects.
    expect(typewriterScrollTop({ ...base, lineTop: 390, lineBottom: 410 })).toBeNull(); // dead centre
    expect(typewriterScrollTop({ ...base, lineTop: 100, lineBottom: 120 })).toBeNull();
    expect(typewriterScrollTop({ ...base, lineTop: -500, lineBottom: -480 })).toBeNull(); // off the top
  });

  it("clamps to the end of the scrollable range instead of over-scrolling", () => {
    // 40vh of bottom padding (theme.ts) is what makes centring possible near the end
    // at all; past that limit the caret legitimately sits below the midpoint.
    const g = { ...base, scrollHeight: 2000, scrollTop: 1150 }; // max scrollTop = 1200
    expect(typewriterScrollTop(g)).toBe(1200);
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
        const next = typewriterScrollTop({
          ...base,
          lineTop,
          lineBottom: lineTop + 20,
          scrollHeight,
        });
        if (next === null) continue;
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThanOrEqual(scrollHeight - base.viewportHeight);
      }
    }
  });

  it("centres against the SHRUNKEN viewport when the Android keyboard is open", () => {
    // --kb-inset (M6 S3) shrinks .app 952 -> 579 on a Pixel 9 Pro; the midpoint must
    // follow, or the caret would be centred on a viewport that no longer exists.
    // caret centre 553.5, target 289.5 -> +264
    const phone = { scrollTop: 400, viewportHeight: 579, scrollHeight: 5000, lineTop: 540, lineBottom: 567 };
    expect(typewriterScrollTop(phone)).toBe(664);
  });

  it("returns whole pixels", () => {
    const g = { ...base, lineTop: 701, lineBottom: 722 }; // centre 711.5 -> delta 311.5
    const next = typewriterScrollTop(g);
    expect(Number.isInteger(next)).toBe(true);
    expect(next).toBe(1312);
  });
});
