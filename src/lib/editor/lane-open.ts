import type { LaneStrategy } from "../settings/schema";

/**
 * Pure math for the collapsible left-edge lanes (REQ-LANE-4, SPEC §7.6). A lane's
 * "open" scalar ∈ [0,1] scales its reserved width (theme.ts multiplies width×open):
 * 1 = fully shown, 0 = collapsed (content reclaims the strip). The three display
 * states are `hide` (0), `show` (1), and `reveal` (a partial peek, 0<open<1 — the
 * touch gesture, a later slice; on desktop reveal ≡ show). These functions are
 * framework-free so the layout policy is 100%-unit-tested; the ViewPlugin that
 * writes the CSS vars + the shell breakpoint wiring are covered live (WF-39).
 */

/** Clamp to the open-fraction range [0,1]. */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Per-frame fraction of the remaining distance the collapse tween covers
 *  (exponential ease-out). ~0.3 settles a full 0↔1 sweep in ~13 frames (~215ms at
 *  60fps) — smooth but never sluggish. Frame-rate dependent by design (v1 static
 *  collapse); the gesture slice will drive it 1:1 instead. */
export const TWEEN_RATE = 0.3;
/** Snap-to-target threshold: below this remaining distance the tween finishes. At
 *  the widest lane (marker ≈ 3.2em ≈ 51px @16px) 0.004 is <0.25px — sub-pixel, so
 *  the final frame is visually indistinguishable from an exact landing. */
export const TWEEN_EPS = 0.004;

/**
 * One eased step of the collapse tween: the next displayed open value moving `cur`
 * toward `target`. Snaps exactly to `target` once within TWEEN_EPS so the tween
 * terminates (an exponential ease is otherwise asymptotic). Pure so the animation
 * curve is unit-tested; the ViewPlugin only owns the rAF loop + DOM writes.
 */
export function stepOpen(cur: number, target: number, rate = TWEEN_RATE): number {
  const d = target - cur;
  if (Math.abs(d) <= TWEEN_EPS) return target;
  return cur + d * rate;
}

/**
 * The open scalar to WRITE for a lane given its strategy and (for a drawer) the
 * runtime open fraction. `reserved` is always fully shown; `off` is collapsed (its
 * width is already 0px via applyLanes, so this is belt-and-suspenders); `drawer`
 * takes the runtime value.
 */
export function openForLane(strategy: LaneStrategy, drawerOpen: number): number {
  if (strategy === "reserved") return 1;
  if (strategy === "off") return 0;
  return clamp01(drawerOpen);
}

/** The per-breakpoint open default for a drawer lane (SPEC §7.6): narrow viewports
 *  auto-collapse, wide default to open. */
export function resolveDefaultOpen(
  isNarrow: boolean,
  d: { narrow: boolean; wide: boolean },
): boolean {
  return isNarrow ? d.narrow : d.wide;
}

/**
 * Resolve the open scalar for one lane from its settings, the current breakpoint,
 * and the session state. A drawer the user has touched this session keeps its
 * remembered value (so rotating/resizing never yanks away a chosen collapse); an
 * untouched drawer takes its per-breakpoint default. `reserved`→1, `off`→0 always.
 */
export function resolveLaneOpen(
  strategy: LaneStrategy,
  defaultOpen: { narrow: boolean; wide: boolean },
  isNarrow: boolean,
  session: { touched: boolean; open: number } | null,
): number {
  if (strategy !== "drawer") return openForLane(strategy, 0);
  if (session && session.touched) return clamp01(session.open);
  return resolveDefaultOpen(isNarrow, defaultOpen) ? 1 : 0;
}
