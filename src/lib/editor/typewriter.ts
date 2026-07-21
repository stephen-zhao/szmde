import { Compartment, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * REQ-SCROLL-1 — typewriter scrolling (SPEC §4.5).
 *
 * CodeMirror's `scrollIntoView` performs the MINIMUM scroll, so a caret moving
 * downward comes to rest one line inside the bottom edge. That is the worst place to
 * work: on a phone it lands hard against the soft keyboard AND underneath the
 * bottom-right status chips, so most of the line being edited is obscured (measured on a
 * physical Pixel 9 Pro in M6 S3: active line at y=555-578 with the chips at y=509-571).
 *
 * The fix is a `scrollMargins` facet rather than explicit centre-scrolls. Two reasons:
 *   - it applies to EVERY existing `scrollIntoView: true` dispatch (there are ~14 across
 *     keymap.ts, tables, alerts, hr, …) without touching any of them, and
 *   - it cannot loop: an `updateListener` that dispatches its own scroll effect on every
 *     selection change would re-enter.
 *
 * Only a BOTTOM margin is reserved. A matching top margin would force a re-centre when
 * moving the cursor UP too, which reads as the document lurching under you; keeping the
 * caret from ever sinking below the midpoint is what the requirement actually asks for
 * ("the last line when typing is centred").
 */

/** Whether typewriter scrolling is on (settings `editor.typewriterScrolling`). */
export const typewriterEnabled = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1] : true),
});

export const typewriterCompartment = new Compartment();

export function setTypewriter(view: EditorView, on: boolean) {
  view.dispatch({ effects: typewriterCompartment.reconfigure(typewriterEnabled.of(on)) });
}

/**
 * The bottom scroll margin, in px, for a scroller of `scrollerHeight`.
 *
 * Pure so the arithmetic is unit-testable without a live EditorView. Returns 0 for an
 * unmeasured or nonsensical height: `.cm-scroller` reports 0 before first layout, and a
 * negative margin would make `scrollIntoView` push the caret OFF screen rather than into
 * view. Half the height keeps the margin strictly below the viewport, so the target can
 * always still be satisfied.
 */
export function typewriterBottomMargin(scrollerHeight: number, enabled: boolean): number {
  if (!enabled) return 0;
  if (!Number.isFinite(scrollerHeight) || scrollerHeight <= 0) return 0;
  return Math.round(scrollerHeight / 2);
}

/**
 * Reserve the bottom margin for every scrollIntoView in the editor.
 *
 * Read from the live scroller each time (not cached) so it tracks window resizes, the
 * REQ-ZOOM font/width changes, and — on Android — the soft keyboard shrinking `.app` via
 * `--kb-inset` (M6 S3), where the visible height drops from 952 to 579.
 */
export const typewriterScrollMargins = EditorView.scrollMargins.of((view) => {
  const bottom = typewriterBottomMargin(
    view.scrollDOM.clientHeight,
    view.state.facet(typewriterEnabled),
  );
  return bottom > 0 ? { bottom } : null;
});
