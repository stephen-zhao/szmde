import { describe, expect, it, vi } from "vitest";
import {
  handleZoomWheel,
  stepFontSize,
  stepLineWidth,
  LINE_WIDTH_STEP,
  zoomGestures,
  type ZoomConfig,
} from "./zoom";
import { LINE_WIDTH_MAX, LINE_WIDTH_MIN } from "../settings/schema";

const ev = (over: Partial<WheelEvent>) =>
  ({ deltaY: -100, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), ...over }) as unknown as WheelEvent;
const cfg = () => ({ onZoomFont: vi.fn(), onZoomWidth: vi.fn() }) satisfies ZoomConfig;

describe("[REQ-ZOOM-1] stepFontSize", () => {
  it("steps by 1px and clamps to [10,32]", () => {
    expect(stepFontSize(16, 1)).toBe(17);
    expect(stepFontSize(16, -1)).toBe(15);
    expect(stepFontSize(10, -1)).toBe(10);
    expect(stepFontSize(32, 1)).toBe(32);
  });
});

describe("[REQ-ZOOM-2][REQ-ZOOM-3] stepLineWidth", () => {
  it(`steps by ${LINE_WIDTH_STEP}px per tick`, () => {
    expect(stepLineWidth(740, 1)).toBe(740 + LINE_WIDTH_STEP);
    expect(stepLineWidth(740, -1)).toBe(740 - LINE_WIDTH_STEP);
    expect(stepLineWidth(740, 3)).toBe(740 + 3 * LINE_WIDTH_STEP);
  });

  it("clamps to the absolute min/max when no window cap is given", () => {
    expect(stepLineWidth(LINE_WIDTH_MIN, -1)).toBe(LINE_WIDTH_MIN);
    expect(stepLineWidth(LINE_WIDTH_MAX, 1)).toBe(LINE_WIDTH_MAX);
  });

  it("caps growth at the supplied window width (REQ-ZOOM-3)", () => {
    // Already at the window width → a widen step can't exceed it.
    expect(stepLineWidth(1000, 1, 1000)).toBe(1000);
    // Near the window width → clamps exactly to it, not past.
    expect(stepLineWidth(980, 5, 1000)).toBe(1000);
    // Below it → grows normally.
    expect(stepLineWidth(700, 1, 1000)).toBe(700 + LINE_WIDTH_STEP);
  });

  it("never drops below the min even on a tiny window", () => {
    expect(stepLineWidth(320, -10, 200)).toBe(LINE_WIDTH_MIN);
  });

  it("rounds a non-step-aligned current width before stepping", () => {
    expect(stepLineWidth(733, 1)).toBe(733 + LINE_WIDTH_STEP);
  });
});

describe("[REQ-ZOOM-1][REQ-ZOOM-2] handleZoomWheel", () => {
  it("ctrl+wheel up zooms the font in (+1) and preventDefaults", () => {
    const c = cfg();
    const e = ev({ deltaY: -100, ctrlKey: true });
    expect(handleZoomWheel(c, e)).toBe(true);
    expect(c.onZoomFont).toHaveBeenCalledWith(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("ctrl+wheel down zooms the font out (-1)", () => {
    const c = cfg();
    handleZoomWheel(c, ev({ deltaY: 100, ctrlKey: true }));
    expect(c.onZoomFont).toHaveBeenCalledWith(-1);
  });

  it("cmd+wheel zooms the font (macOS)", () => {
    const c = cfg();
    handleZoomWheel(c, ev({ deltaY: -100, metaKey: true }));
    expect(c.onZoomFont).toHaveBeenCalledWith(1);
  });

  it("shift+wheel zooms the page width and preventDefaults", () => {
    const c = cfg();
    const e = ev({ deltaY: -100, shiftKey: true });
    expect(handleZoomWheel(c, e)).toBe(true);
    expect(c.onZoomWidth).toHaveBeenCalledWith(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("a plain wheel is left to normal scrolling (no preventDefault, returns false)", () => {
    const c = cfg();
    const e = ev({ deltaY: 100 });
    expect(handleZoomWheel(c, e)).toBe(false);
    expect(c.onZoomFont).not.toHaveBeenCalled();
    expect(c.onZoomWidth).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("a zero-delta wheel is a no-op", () => {
    const c = cfg();
    expect(handleZoomWheel(c, ev({ deltaY: 0, ctrlKey: true }))).toBe(false);
    expect(c.onZoomFont).not.toHaveBeenCalled();
  });
});

describe("zoomGestures", () => {
  it("builds a wheel-handler extension", () => {
    expect(zoomGestures(cfg())).toBeTruthy();
  });
});
