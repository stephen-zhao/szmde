import { describe, expect, it } from "vitest";
import {
  clamp01,
  openForLane,
  resolveDefaultOpen,
  resolveLaneOpen,
  stepOpen,
  TWEEN_EPS,
  TWEEN_RATE,
} from "./lane-open";

describe("[REQ-LANE-4] clamp01", () => {
  it("clamps to [0,1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(1.7)).toBe(1);
  });
});

describe("[REQ-LANE-4] openForLane — strategy → open scalar", () => {
  it("reserved is always fully shown", () => {
    expect(openForLane("reserved", 0)).toBe(1);
    expect(openForLane("reserved", 0.3)).toBe(1);
  });
  it("off is always collapsed", () => {
    expect(openForLane("off", 1)).toBe(0);
  });
  it("drawer takes the (clamped) runtime value", () => {
    expect(openForLane("drawer", 0)).toBe(0);
    expect(openForLane("drawer", 0.5)).toBe(0.5);
    expect(openForLane("drawer", 1)).toBe(1);
    expect(openForLane("drawer", 2)).toBe(1); // clamped
  });
});

describe("[REQ-LANE-4] resolveDefaultOpen — per-breakpoint default", () => {
  it("picks the narrow default on narrow, the wide default on wide", () => {
    const d = { narrow: false, wide: true };
    expect(resolveDefaultOpen(true, d)).toBe(false); // narrow → auto-collapse
    expect(resolveDefaultOpen(false, d)).toBe(true); // wide → open
  });
  it("honors an inverted config", () => {
    const d = { narrow: true, wide: false };
    expect(resolveDefaultOpen(true, d)).toBe(true);
    expect(resolveDefaultOpen(false, d)).toBe(false);
  });
});

describe("[REQ-LANE-4] resolveLaneOpen — settings + breakpoint + session", () => {
  const dflt = { narrow: false, wide: true };

  it("a non-drawer lane ignores breakpoint/session (reserved→1, off→0)", () => {
    expect(resolveLaneOpen("reserved", dflt, true, { touched: true, open: 0 })).toBe(1);
    expect(resolveLaneOpen("off", dflt, false, { touched: true, open: 1 })).toBe(0);
  });

  it("an untouched drawer takes its per-breakpoint default", () => {
    expect(resolveLaneOpen("drawer", dflt, true, null)).toBe(0); // narrow → collapsed
    expect(resolveLaneOpen("drawer", dflt, false, null)).toBe(1); // wide → open
    expect(resolveLaneOpen("drawer", dflt, true, { touched: false, open: 1 })).toBe(0); // untouched ignores stale open
  });

  it("a touched drawer keeps its remembered (clamped) value across breakpoint changes", () => {
    expect(resolveLaneOpen("drawer", dflt, true, { touched: true, open: 1 })).toBe(1); // narrow, but user opened it
    expect(resolveLaneOpen("drawer", dflt, false, { touched: true, open: 0 })).toBe(0); // wide, but user collapsed it
    expect(resolveLaneOpen("drawer", dflt, false, { touched: true, open: 1.5 })).toBe(1); // clamped
  });
});

describe("[REQ-LANE-4] stepOpen — collapse-tween easing", () => {
  it("moves TWEEN_RATE of the remaining distance toward the target", () => {
    // From 0 toward 1: the first frame lands exactly at the rate.
    expect(stepOpen(0, 1)).toBeCloseTo(TWEEN_RATE, 10);
    // Symmetric collapsing: from 1 toward 0 covers the same fraction downward.
    expect(stepOpen(1, 0)).toBeCloseTo(1 - TWEEN_RATE, 10);
  });

  it("snaps exactly to the target once within TWEEN_EPS (so the tween terminates)", () => {
    // An exponential ease is asymptotic; without the snap it would never land.
    expect(stepOpen(1 - TWEEN_EPS / 2, 1)).toBe(1);
    expect(stepOpen(TWEEN_EPS / 2, 0)).toBe(0);
    // Already exactly at target → stays put (zero distance is within EPS).
    expect(stepOpen(0.5, 0.5)).toBe(0.5);
  });

  it("converges to the target within a bounded number of frames", () => {
    let v = 0;
    let frames = 0;
    while (v !== 1 && frames < 100) {
      v = stepOpen(v, 1);
      frames++;
    }
    expect(v).toBe(1);
    expect(frames).toBeLessThan(30); // ~13 at rate 0.3; never sluggish
  });

  it("honours a custom rate", () => {
    expect(stepOpen(0, 1, 0.5)).toBeCloseTo(0.5, 10);
  });
});
