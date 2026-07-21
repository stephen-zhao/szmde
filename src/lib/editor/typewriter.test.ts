import { describe, it, expect } from "vitest";
import { typewriterBottomMargin } from "./typewriter";

describe("[REQ-SCROLL-1] typewriterBottomMargin", () => {
  it("reserves half the visible height so the caret comes to rest at the vertical centre", () => {
    // CodeMirror's scrollIntoView keeps the target at least `bottom` px above the
    // bottom edge, so a margin of h/2 parks a downward-moving caret on the midpoint.
    expect(typewriterBottomMargin(952, true)).toBe(476);
    expect(typewriterBottomMargin(579, true)).toBe(290); // phone, keyboard open
  });

  it("is 0 when disabled, so CodeMirror's default minimal scrolling is restored", () => {
    expect(typewriterBottomMargin(952, false)).toBe(0);
    expect(typewriterBottomMargin(579, false)).toBe(0);
  });

  it("is 0 for a viewport that has not been measured yet", () => {
    // .cm-scroller reports 0 before first layout (and during some Android IME
    // transitions); a margin derived from that would be meaningless, and a NEGATIVE
    // margin would make scrollIntoView push the caret OFF screen.
    expect(typewriterBottomMargin(0, true)).toBe(0);
    expect(typewriterBottomMargin(-100, true)).toBe(0);
    expect(typewriterBottomMargin(Number.NaN, true)).toBe(0);
    expect(typewriterBottomMargin(Number.POSITIVE_INFINITY, true)).toBe(0);
  });

  it("rounds to whole pixels", () => {
    expect(typewriterBottomMargin(701, true)).toBe(351);
    expect(Number.isInteger(typewriterBottomMargin(333, true))).toBe(true);
  });

  it("never exceeds the viewport, so the target can always still fit", () => {
    // A margin >= h would leave scrollIntoView no room to satisfy and makes CM's
    // scroll behaviour undefined. Half is safely under that bound at every size.
    for (const h of [1, 2, 3, 50, 579, 952, 4000]) {
      expect(typewriterBottomMargin(h, true)).toBeLessThan(h + 1);
    }
  });
});
