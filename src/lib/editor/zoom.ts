import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { LINE_WIDTH_MAX, LINE_WIDTH_MIN } from "../settings/schema";

/**
 * Scroll-gesture zoom (REQ-ZOOM-1/2, SPEC §7.3): Ctrl/Cmd+wheel changes the base
 * text size, Shift+wheel changes the reading-column width. The editor stays
 * framework-agnostic — it pushes step deltas out via `ZoomConfig` callbacks; the
 * shell does the settings math + persistence (the CSS vars `--editor-font-size` /
 * `--reading-width` apply the result). One step per event (sign of deltaY), so the
 * gesture feels consistent across mice/trackpads regardless of delta magnitude.
 */
export interface ZoomConfig {
  onZoomFont(steps: number): void;
  onZoomWidth(steps: number): void;
}

/** Reading-width change per Shift-scroll tick, in px (REQ-ZOOM-2/3). */
export const LINE_WIDTH_STEP = 40;

/** Clamp the base font size after a zoom step (REQ-ZOOM-1). */
export function stepFontSize(cur: number, steps: number, min = 10, max = 32): number {
  return Math.max(min, Math.min(max, cur + steps));
}

/**
 * Step the reading-column width by `steps` (px deltas of LINE_WIDTH_STEP each),
 * clamped to [LINE_WIDTH_MIN, max] (REQ-ZOOM-2/3). `max` defaults to the absolute
 * guard ceiling; the shell passes the current window width so the column can grow
 * "as wide as the window" but no wider, and shrinks back as the window shrinks.
 */
export function stepLineWidth(
  cur: number,
  steps: number,
  max = LINE_WIDTH_MAX,
  min = LINE_WIDTH_MIN,
): number {
  return Math.max(min, Math.min(max, Math.round(cur) + steps * LINE_WIDTH_STEP));
}

/** The wheel logic, extracted so it's unit-testable without a live view. Returns
 *  true (and preventDefault's) when it handled the gesture, false otherwise. */
export function handleZoomWheel(cfg: ZoomConfig, e: WheelEvent): boolean {
  if (e.deltaY === 0) return false;
  const step = -Math.sign(e.deltaY); // scroll up → bigger (OS zoom convention)
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    cfg.onZoomFont(step);
    return true;
  }
  if (e.shiftKey) {
    e.preventDefault();
    cfg.onZoomWidth(step);
    return true;
  }
  return false; // plain scroll → let the editor scroll normally
}

export function zoomGestures(cfg: ZoomConfig): Extension {
  return EditorView.domEventHandlers({
    /* v8 ignore next -- a wheel event isn't delivered to CM's domEventHandlers in
       happy-dom; the handler logic is unit-tested directly via handleZoomWheel. */
    wheel: (e) => handleZoomWheel(cfg, e),
  });
}
