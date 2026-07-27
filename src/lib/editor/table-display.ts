import type { EditorView } from "@codemirror/view";
import {
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type EditorState,
} from "@codemirror/state";
import { tableBlockAt } from "./table-commands";

// ---------------------------------------------------------------------------
// Per-table display state (REQ-TBLED-10 width mode, REQ-TBLED-11 pin header).
//
// Both are DISPLAY-ONLY, per-table toggles — the on-disk artifact stays plain
// GFM. Like the code-block `wrapOverrides` (setup.ts), this is EPHEMERAL state
// that lives OFF the document: a RangeSet keyed by the table block's [from, to)
// that maps through edits (`set.map`) so a table keeps its display as the doc
// around it changes. A table with no override renders the DEFAULT.
//
// Structural table ops rewrite the whole block (a doc change), which maps the
// override with it, so a table's chosen width/pin survives an insert/move/etc.
// ---------------------------------------------------------------------------

export type WidthMode = "fit" | "overflow";

export interface TableDisplay {
  /** `fit` (default) sizes the table to the reading width; `overflow` sizes each
   *  column to its header cell and scrolls the table independently. */
  width: WidthMode;
  /** When true, the header row stays sticky as a long table scrolls. */
  pin: boolean;
}

export const DEFAULT_TABLE_DISPLAY: TableDisplay = { width: "fit", pin: false };

class TableDisplayOverride extends RangeValue {
  constructor(readonly display: TableDisplay) {
    super();
  }
  /* v8 ignore start -- RangeValue.eq is CM-internal set-diff plumbing; the
     tableDisplays field is read via between(), which never invokes eq. */
  eq(other: RangeValue) {
    return (
      other instanceof TableDisplayOverride &&
      other.display.width === this.display.width &&
      other.display.pin === this.display.pin
    );
  }
  /* v8 ignore stop */
}

/** Set (replace) the display for the table block spanning [from, to). */
export const setTableDisplay =
  StateEffect.define<{ from: number; to: number; display: TableDisplay }>();
/** Drop every per-table override (e.g. a future "reset all" control). */
export const clearTableDisplays = StateEffect.define<null>();

export const tableDisplays = StateField.define<RangeSet<TableDisplayOverride>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearTableDisplays)) {
        set = RangeSet.empty;
      } else if (e.is(setTableDisplay)) {
        const { from, to, display } = e.value;
        set = set.update({
          filterFrom: from,
          filterTo: to,
          filter: () => false, // drop any existing override over this block
          add: [new TableDisplayOverride(display).range(from, to)],
        });
      }
    }
    return set;
  },
});

/** The effective display for the table block spanning [from, to). */
export function tableDisplayAt(state: EditorState, from: number, to: number): TableDisplay {
  let display = DEFAULT_TABLE_DISPLAY;
  const set = state.field(tableDisplays, false);
  if (set) {
    set.between(from, to, (_f, _t, v) => {
      display = v.display;
      return false; // first match wins
    });
  }
  return display;
}

/** Re-resolve the table block at `anchor` and store a display derived from its
 *  current one. Returns false (no dispatch) when `anchor` isn't in/adjacent to a
 *  table — so a menu/command path can pass the key through. */
function mutateTableDisplay(
  view: EditorView,
  anchor: number,
  mut: (cur: TableDisplay) => TableDisplay,
): boolean {
  const tbl = tableBlockAt(view.state, anchor);
  if (!tbl) return false;
  const cur = tableDisplayAt(view.state, tbl.from, tbl.to);
  view.dispatch({
    effects: setTableDisplay.of({ from: tbl.from, to: tbl.to, display: mut(cur) }),
  });
  return true;
}

/** Set the width mode of the table at `anchor` (the right-click menu path). */
export function setTableWidthMode(view: EditorView, anchor: number, width: WidthMode): boolean {
  return mutateTableDisplay(view, anchor, (c) => ({ ...c, width }));
}

/** Set header-pin on/off for the table at `anchor` (the right-click menu path). */
export function setTablePinHeader(view: EditorView, anchor: number, pin: boolean): boolean {
  return mutateTableDisplay(view, anchor, (c) => ({ ...c, pin }));
}
