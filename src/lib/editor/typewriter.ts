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
 * Implemented as an `EditorView.scrollHandler`, which fires from exactly one place —
 * `docView.scrollIntoView` — and therefore applies to every `scrollIntoView: true`
 * dispatch (10 of them, across keymap.ts, table-commands.ts, alerts.ts and hr.ts)
 * without editing any of them.
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

/**
 * Centre the active line on every scroll-into-view request.
 *
 * Runs inside `docView.scrollIntoView`, before CodeMirror's own scrolling; returning
 * `true` means "handled". We decline (returning `false`) whenever the caller asked for
 * a specific placement (`y` other than `"nearest"`) so go-to-line and friends land
 * where they asked, and whenever the content can scroll horizontally — handling the
 * scroll suppresses CodeMirror's horizontal scrolling too, which would strand the caret
 * off the right edge. `EditorView.lineWrapping` is on today, so that never happens.
 *
 * **`view.coordsAtPos()` must not be used here.** Scroll handlers run inside
 * CodeMirror's update, where its `readMeasured()` guard throws "Reading the editor
 * layout isn't allowed during an update"; `docView.scrollIntoView` catches that,
 * `logException`s it, and treats the handler as declined. That is how the first version
 * of this silently did nothing in the real app while every unit test passed — caught by
 * driving the live editor, not by the suite. `lineBlockAt` / `documentTop` /
 * `defaultLineHeight` are public, synchronous and unguarded (they read the height map).
 *
 * Because the reference is a *line block*, a wrapped paragraph is measured by its LAST
 * visual row (`bottom`, back-limited to one line height). That is the row being typed
 * on, and it makes the guarantee slightly stronger: the whole tail of the line stays at
 * or above the midpoint.
 *
 * Geometry is read live on every call, so it tracks window resizes, the REQ-ZOOM
 * font/width changes, and — on Android — the soft keyboard shrinking `.app` from 952 to
 * 579 via `--kb-inset` (M6 S3).
 */
export const typewriterScrollHandler = EditorView.scrollHandler.of((view, range, options) => {
  if (!view.state.facet(typewriterEnabled)) return false;
  if (options.y !== "nearest") return false;

  const scroller = view.scrollDOM;
  if (scroller.scrollWidth > scroller.clientWidth) return false;

  const block = view.lineBlockAt(range.head);
  const boxTop = scroller.getBoundingClientRect().top;
  const lineBottom = view.documentTop + block.bottom - boxTop;
  const lineTop = Math.max(view.documentTop + block.top - boxTop, lineBottom - view.defaultLineHeight);

  const next = typewriterScrollTop({
    scrollTop: scroller.scrollTop,
    viewportHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
    lineTop,
    lineBottom,
  });
  if (next === null) return false;

  scroller.scrollTop = next;
  return true;
});
