import { EditorView, ViewPlugin } from "@codemirror/view";
import type { PluginValue, ViewUpdate } from "@codemirror/view";
import { Facet, StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { LANE_IDS, LANE_REGISTRY } from "../settings/lanes";
import type { LaneId } from "../settings/schema";
import { clamp01, stepOpen } from "./lane-open";

/**
 * The collapsible left-edge lanes (REQ-LANE-4, SPEC §7.6) — model + static
 * collapse. Each lane carries an "open" scalar ∈[0,1] that theme.ts multiplies its
 * reserved width by (width×open): 1 = fully shown, 0 = collapsed so the content
 * reclaims the strip. This module owns the CodeMirror seam:
 *
 *   • `laneOpenField` — the TARGET open value per lane, seeded from `laneOpenSeed`
 *     and updated by the `setLaneOpen` effect. It re-seeds from the facet on every
 *     `setState` (file open); Editor.svelte re-passes the live values through the
 *     facet, so a user-chosen collapse survives opening another file (hole #4).
 *   • `laneDrawers` — a ViewPlugin that tweens the DISPLAYED value toward the
 *     target over animation frames, writing `--fold-open` / `--marker-open` on the
 *     editor's OUTER element (`view.dom`, the `.cm-editor`) and forcing a re-measure
 *     each frame so the caret stays glued to the shifting content (the content shift
 *     is genuine padding, the only channel CodeMirror measures — REQ-RENDER-9's
 *     caret-fix invariant). The scalars are custom properties, so setting them on the
 *     ancestor `.cm-editor` inherits down to `.cm-content` (whose padding calc reads
 *     them) and the fold chevron. Deliberately NOT `contentDOM` — CodeMirror rebuilds
 *     `contentDOM.style.cssText` wholesale in `updateAttrs` on construction and every
 *     setState, which would wipe an inline write there — and NOT `:root`, which would
 *     wake markers.ts's documentElement font observer on every tween frame.
 *
 * The POLICY (which open value a lane should hold, given strategy/breakpoint/session)
 * is pure and unit-tested in lane-open.ts; the orchestrator (+page.svelte) computes
 * it and pushes it here. This module only stores + animates the resulting scalars.
 */

/** The per-lane open scalar map — the unit theme.ts multiplies each lane width by. */
export type LaneOpen = Record<LaneId, number>;

/** Every lane fully open — byte-identical to the pre-drawer layout (width×1). The
 *  facet/field default, so an editor built without an explicit seed renders exactly
 *  as it did before REQ-LANE-4. */
export const DEFAULT_LANE_OPEN: LaneOpen = Object.fromEntries(
  LANE_IDS.map((id) => [id, 1]),
) as LaneOpen;

/** Copy an open map, clamping each lane to [0,1] (defensive — callers already
 *  clamp via lane-open.ts, but the field is a public seam). */
function normalizeOpen(o: LaneOpen): LaneOpen {
  return Object.fromEntries(LANE_IDS.map((id) => [id, clamp01(o[id])])) as LaneOpen;
}

/** The initial target open values, provided at editor-construction time
 *  (Editor.svelte → editorExtensions). Last value wins; absent ⇒ all-open. */
export const laneOpenSeed = Facet.define<LaneOpen, LaneOpen>({
  combine: (vals) => (vals.length ? normalizeOpen(vals[vals.length - 1]) : DEFAULT_LANE_OPEN),
});

/**
 * Set one or more lanes' target open value. `animate` is the CALLER's intent —
 * NOT plugin state — so snap-vs-tween is decided at the source and is immune to the
 * plugin being recreated on setState (file open): initial seeds / settings loads /
 * breakpoint auto-collapse pass `animate:false` (reflect instantly, no cold-load
 * slide), a user toggle / live flip passes `animate:true` (tween). Only the `open`
 * values enter the field; `animate` is read off the transaction by the plugin.
 */
export const setLaneOpen = StateEffect.define<{ open: Partial<LaneOpen>; animate: boolean }>();

/** Whether any setLaneOpen effect in this transaction asked to animate. */
function txWantsAnimation(tr: { effects: readonly StateEffect<unknown>[] }): boolean {
  return tr.effects.some((e) => e.is(setLaneOpen) && e.value.animate);
}

/** The target open value per lane. Survives edits; RESETS on setState (file open) —
 *  where it re-reads the facet, which Editor.svelte re-seeds with the live values. */
export const laneOpenField = StateField.define<LaneOpen>({
  create: (state) => ({ ...state.facet(laneOpenSeed) }),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setLaneOpen)) {
        const patch = e.value.open;
        const merged = { ...next };
        for (const id of LANE_IDS) {
          if (patch[id] !== undefined) merged[id] = clamp01(patch[id] as number);
        }
        next = merged;
      }
    }
    return next;
  },
});

/** Identity for `requestMeasure` de-duplication — SEPARATE from typewriter's key so
 *  the two never coalesce (one measures the caret row, the other realigns the
 *  horizontal content origin). At most one lane re-measure pending per frame. */
const laneMeasureKey = {};

/** True once every lane's displayed value has reached its target. */
function settled(cur: LaneOpen, target: LaneOpen): boolean {
  return LANE_IDS.every((id) => cur[id] === target[id]);
}

class LaneDrawersPlugin implements PluginValue {
  /** The currently DISPLAYED (tweened) open values — chases the field's target. */
  private cur: LaneOpen;
  private frame: number | null = null;

  constructor(readonly view: EditorView) {
    this.cur = { ...view.state.field(laneOpenField) };
    // Reflect the seed immediately so the first paint is correct — critically, a
    // collapse carried across a file open (setState re-seeds the field, hole #4)
    // shows collapsed from frame one. We write to `view.dom`, which `updateAttrs`
    // never touches, so this survives the construction-time attr sync (unlike
    // contentDOM). At the all-open default it's a no-op on the rendered width.
    this.writeVars();
  }

  update(u: ViewUpdate) {
    if (u.startState.field(laneOpenField) === u.state.field(laneOpenField)) return;
    // Snap-vs-tween is the CALLER's intent (the setLaneOpen effect's `animate`), not
    // plugin-instance state — so a cold-load / settings-load / file-open re-seed
    // reflects instantly no matter how many times the plugin is recreated, while a
    // genuine user toggle / live breakpoint flip always animates.
    if (!u.transactions.some(txWantsAnimation)) {
      this.cur = { ...u.state.field(laneOpenField) };
      this.writeVars();
      this.view.requestMeasure({ key: laneMeasureKey, read: measureNoop, write: measureNoop });
      return;
    }
    this.schedule();
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }

  /** Schedule a tween frame if one isn't already pending (idempotent per frame). */
  private schedule() {
    if (this.frame === null) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.frame = null;
    const target = this.view.state.field(laneOpenField);
    for (const id of LANE_IDS) {
      this.cur[id] = stepOpen(this.cur[id], target[id]);
    }
    this.writeVars();
    // The padding just changed; force CodeMirror to re-read geometry so the caret
    // and selection layers track the shifted content origin THIS frame.
    this.view.requestMeasure({ key: laneMeasureKey, read: measureNoop, write: measureNoop });
    if (!settled(this.cur, target)) this.schedule();
  };

  /** Write the displayed open scalars onto the outer .cm-editor (see module doc);
   *  they inherit down to .cm-content's padding calc and the fold chevron. */
  private writeVars() {
    const s = this.view.dom.style;
    for (const id of LANE_IDS) {
      s.setProperty(LANE_REGISTRY[id].openVar, String(this.cur[id]));
    }
  }
}

/** No-op measure callbacks: scheduling the request is what forces CodeMirror's
 *  measure pass (which repositions the caret); there is nothing to read or write
 *  ourselves. Named (not inline) so the shared reference is covered once. */
function measureNoop() {}

export const laneDrawers = ViewPlugin.fromClass(LaneDrawersPlugin);

/**
 * The lane-drawers extension bundle: the target field (seeded from `initial`) plus
 * the tweening ViewPlugin. Registered in setup.ts; `initial` comes from
 * Editor.svelte's live lane-open state so it re-seeds correctly across file opens.
 */
export function laneDrawersExtension(initial: LaneOpen = DEFAULT_LANE_OPEN): Extension[] {
  return [laneOpenSeed.of(initial), laneOpenField, laneDrawers];
}
