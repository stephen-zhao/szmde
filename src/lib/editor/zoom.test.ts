import { describe, expect, it, vi } from "vitest";
import { handleZoomWheel, stepFontSize, stepLineWidth, zoomGestures, type ZoomConfig } from "./zoom";

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

describe("[REQ-ZOOM-2] stepLineWidth", () => {
  it("steps the enum and clamps at the ends", () => {
    expect(stepLineWidth("narrow", 1)).toBe("medium");
    expect(stepLineWidth("medium", 1)).toBe("wide");
    expect(stepLineWidth("wide", 1)).toBe("wide");
    expect(stepLineWidth("medium", -1)).toBe("narrow");
    expect(stepLineWidth("narrow", -1)).toBe("narrow");
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
