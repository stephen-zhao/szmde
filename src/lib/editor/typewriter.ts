import { Compartment, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * REQ-SCROLL-1 — typewriter scrolling (SPEC §4.5).
 *
 * CodeMirror's `scrollIntoView` performs the MINIMUM scroll, so a caret moving
 * downward comes to rest one line inside the bottom edge. That is the worst place to
 * work: on a phone the line being typed lands underneath the fixed bottom-right status
 * chips, so most of it is unreadable (measured on a physical Pixel 9 Pro during M6 S3:
 * active line at y=555-578 with the chips at y=509-571 — it cleared the keyboard but
 * not the chips).
 *
 * The invariant, stated exactly: **the active line never comes to rest BELOW the
 * vertical centre.** When a scroll-into-view would leave it lower than that, we scroll
 * so its centre lands on the midpoint. When it is already at or above the midpoint we
 * do nothing at all, so moving the cursor UP keeps CodeMirror's minimal scrolling and
 * the document does not lurch to re-centre.
 *
 * Implemented as an `EditorView.scrollHandler` that never claims the scroll and instead
 * schedules a measure-phase refinement. It fires from exactly one place —
 * `docView.scrollIntoView` — and therefore applies to every `scrollIntoView: true`
 * dispatch (10 of them, across keymap.ts, table-commands.ts, alerts.ts and hr.ts) and to
 * the `EditorView.scrollIntoView` effects @codemirror/search uses, without editing any of
 * them.
 *
 * It is deliberately NOT an `EditorView.scrollMargins` facet, which was the first
 * implementation. That facet has four consumers, and reserving half the viewport as a
 * bottom margin silently broke three of them:
 *   - `pageInfo()` in @codemirror/commands subtracts the margins from the PageUp /
 *     PageDown distance, so paging moved half a screen in BOTH directions;
 *   - `MouseSelection.move()` uses `margins.bottom` as its drag-autoscroll trigger, so
 *     drag-selecting anywhere past the midpoint auto-scrolled at 8px every 50ms;
 *   - tooltip placement shrinks its available space by it;
 *   - and the margin inflates the rect handed to explicit `y: "center"` scrolls, which
 *     then land the target at ~25% height instead of centred.
 * (Found by the adversarial review of the first implementation; the DOM test asserts
 * the extension contributes no scroll margins at all.)
 *
 * Nor is it an `updateListener` that dispatches its own scroll effect — that re-enters.
 */

/** Whether typewriter scrolling is on (settings `editor.typewriterScrolling`). */
export const typewriterEnabled = Facet.define<boolean, boolean>({
  combine: (values) => (values.length ? values[values.length - 1] : true),
});

export const typewriterCompartment = new Compartment();

export function setTypewriter(view: EditorView, on: boolean) {
  view.dispatch({ effects: typewriterCompartment.reconfigure(typewriterEnabled.of(on)) });
}

/** Scroller + active-line geometry, all in px; line coords are relative to the scroller box. */
export type TypewriterGeometry = {
  scrollTop: number;
  /** Visible height of `.cm-scroller` (`clientHeight`). */
  viewportHeight: number;
  /** Total scrollable height (`scrollHeight`) — includes the theme's 40vh bottom pad. */
  scrollHeight: number;
  lineTop: number;
  lineBottom: number;
};

/**
 * The scrollTop that parks the active line on the vertical midpoint, or `null` to leave
 * the scroll to CodeMirror.
 *
 * Pure, so the whole decision is unit-testable without layout. `null` means "not ours":
 * an unmeasured viewport (`.cm-scroller` reports 0 before first layout and during some
 * Android IME transitions), a line already at or above the midpoint, or no room left to
 * scroll — in which case claiming the scroll would suppress CodeMirror's own.
 */
export function typewriterScrollTop(g: TypewriterGeometry): number | null {
  const { scrollTop, viewportHeight, scrollHeight, lineTop, lineBottom } = g;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
  if (!Number.isFinite(lineTop) || !Number.isFinite(lineBottom)) return null;
  if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight)) return null;

  const delta = (lineTop + lineBottom) / 2 - viewportHeight / 2;
  if (delta <= 0) return null; // at or above the midpoint — CodeMirror's default wins

  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
  const next = Math.round(Math.min(scrollTop + delta, maxScrollTop));
  return next > scrollTop ? next : null;
}

/** Identity for `requestMeasure` de-duplication — at most one pending centring. */
const measureKey = {};

/**
 * Measure phase READ: the scrollTop that would centre the caret's own visual row, or
 * `null` for "leave it alone".
 *
 * `view.coordsAtPos` is legal HERE and nowhere near a scroll handler. Its
 * `readMeasured()` guard throws only while CodeMirror is *updating*; measure requests
 * run with `updateState = Measuring`, which is why CodeMirror's own `drawSelection`
 * plugin calls `coordsAtPos` from its measure read too.
 *
 * The caret's visual ROW is what has to be measured. The height map (`lineBlockAt`) only
 * knows whole document lines, and anchoring on a line block's bottom throws the caret
 * off the TOP of the screen whenever it sits on an early row of a wrapped paragraph —
 * e.g. a 13-row paragraph on a 579px phone viewport moved the caret from y=33 to y=-47
 * and flickered on every keystroke. (Found by the round-2 adversarial review, reproduced
 * live.) `coordsAtPos` gives the caret's row directly, so no such approximation is made.
 */
export function typewriterMeasureRead(view: EditorView): number | null {
  if (!view.state.facet(typewriterEnabled)) return null;
  const scroller = view.scrollDOM;
  const coords = view.coordsAtPos(view.state.selection.main.head);
  if (!coords) return null;

  const boxTop = scroller.getBoundingClientRect().top;
  return typewriterScrollTop({
    scrollTop: scroller.scrollTop,
    viewportHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
    lineTop: coords.top - boxTop,
    lineBottom: coords.bottom - boxTop,
  });
}

/** Measure phase WRITE: apply the centring, if the read asked for one. */
export function typewriterMeasureWrite(target: number | null, view: EditorView) {
  if (target !== null) view.scrollDOM.scrollTop = target;
}

/**
 * Centre the active line on every scroll-into-view request.
 *
 * This handler runs inside `docView.scrollIntoView`, which is the one place CodeMirror
 * resolves a scroll target — so it sees every `scrollIntoView: true` dispatch (10 sites
 * across keymap.ts, table-commands.ts, alerts.ts, hr.ts) AND the `EditorView.scrollIntoView`
 * effects that @codemirror/search uses for find-next, without editing any of them.
 *
 * It deliberately **returns `false` every time**. Returning `true` would suppress
 * CodeMirror's own scrolling — including the horizontal scroll and, critically, the
 * corrective scroll that keeps the caret on screen when our arithmetic declines or is
 * wrong. Instead it schedules a measure request: CodeMirror scrolls minimally first, then
 * our write refines that to centred, both inside the same measure loop and therefore
 * within one frame, before the browser paints. The worst failure mode this design admits
 * is "no centring", never "caret off screen".
 *
 * We decline for any `y` other than `"nearest"` so an explicit `y: "center"` / `"start"`
 * / `"end"` request (go-to-line, the search panel's select-all) lands where it asked.
 *
 * Geometry is read live on every call, so it tracks window resizes, the REQ-ZOOM
 * font/width changes, and — on Android — the soft keyboard shrinking `.app` from 952 to
 * 579 via `--kb-inset` (M6 S3).
 */
export const typewriterScrollHandler = EditorView.scrollHandler.of((view, _range, options) => {
  if (!view.state.facet(typewriterEnabled)) return false;
  if (options.y !== "nearest") return false;

  view.requestMeasure({ key: measureKey, read: typewriterMeasureRead, write: typewriterMeasureWrite });
  return false;
});
