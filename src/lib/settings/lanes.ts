import type { LaneId, LanesSettings } from "./schema";

/**
 * The lane registry + CSS-var applier for the left-edge lanes (REQ-LANE-1,
 * SPEC §7.6). Lane SETTINGS (strategy / z-order) live in the settings model and
 * only *reference* lane ids; this module is the code-side source of truth for what
 * each lane IS — its width custom property, its intrinsic reserved width, whether
 * it's mandatory, and how to hide its affordance when the lane is `off`.
 */

export interface LaneDef {
  /** The CSS custom property theme.ts reads for this lane's reserved width. */
  cssVar: string;
  /** Intrinsic reserved width when the lane is `reserved`/`drawer`. Single source
   *  of truth — theme.ts imports these for its pre-settings `var(--…, <width>)`
   *  fallback, so the two never drift. */
  width: string;
  /** SPEC §7.6 carve-out: a mandatory lane may be `reserved`/`drawer` but never
   *  `off` (markers are real text; modes 2/3 are unusable without room to show
   *  them). Enforced in validate.ts. */
  mandatory: boolean;
  /** When present, the lane's affordance is shown via this CSS var (`on`) and
   *  hidden (`none`) when the lane is `off` — so `off` reclaims the width AND
   *  removes the widget rather than leaving it floating in a collapsed lane. */
  contentDisplay?: { var: string; on: string };
}

/** The known lanes, in canonical left-to-right order. The width literals were the
 *  hardcoded `.cm-content` values before REQ-LANE-1 (sized off --editor-font-size
 *  so they scale with zoom); theme.ts now reads them via LANE_REGISTRY. */
export const LANE_REGISTRY: Record<LaneId, LaneDef> = {
  fold: {
    cssVar: "--fold-col",
    width: "calc(var(--editor-font-size) * 1.7)",
    mandatory: false,
    // The fold lane's content is the fold-chevron button (fold.ts). Hiding the lane
    // hides it too; the Mod-. keybinding still folds.
    contentDisplay: { var: "--fold-chevron-display", on: "inline-flex" },
  },
  marker: {
    cssVar: "--marker-gutter",
    width: "calc(var(--editor-font-size) * 3.2)",
    mandatory: true,
  },
};

/** Every known lane id, in registry (canonical) order. */
export const LANE_IDS = Object.keys(LANE_REGISTRY) as LaneId[];

/**
 * Apply the lane model to CSS custom properties on `target` (normally
 * document.documentElement). Pure DOM write — mirrors applyAppearance — so the
 * editor picks up the widths through theme.ts's `var(--…)` with no reconfigure.
 * `reserved`/`drawer` reserve the lane's intrinsic width; `off` collapses it to 0
 * and hides its affordance. (A `drawer` lane still reserves width here until
 * REQ-LANE-4 makes it collapse — only `off` changes today's layout.)
 */
export function applyLanes(target: HTMLElement, lanes: LanesSettings): void {
  const s = target.style;
  for (const id of LANE_IDS) {
    const def = LANE_REGISTRY[id];
    const off = (lanes.byId[id]?.strategy ?? "reserved") === "off";
    s.setProperty(def.cssVar, off ? "0px" : def.width);
    if (def.contentDisplay) {
      s.setProperty(def.contentDisplay.var, off ? "none" : def.contentDisplay.on);
    }
  }
}
