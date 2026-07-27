import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  DEFAULT_TABLE_DISPLAY,
  clearTableDisplays,
  setTableDisplay,
  tableDisplayAt,
  tableDisplays,
  type TableDisplay,
} from "./table-display";

// The per-table display state layer (REQ-TBLED-10 width / REQ-TBLED-11 pin). Mirrors
// the wrapOverrides RangeSet tests (setup.test.ts): default read, override set/replace,
// mapping across edits, clear — all on a plain EditorState (no view needed here; the
// view helpers + widget rendering are covered in table-display.dom.test.ts).
const st = (doc = "0123456789") => EditorState.create({ doc, extensions: [tableDisplays] });
const OVERFLOW: TableDisplay = { width: "overflow", pin: true };

describe("[REQ-TBLED-10][REQ-TBLED-11] tableDisplays — per-table ephemeral display state", () => {
  it("defaults to fit width + unpinned when no override is present", () => {
    expect(DEFAULT_TABLE_DISPLAY).toEqual({ width: "fit", pin: false });
    expect(tableDisplayAt(st(), 0, 10)).toEqual(DEFAULT_TABLE_DISPLAY);
  });

  it("returns the default when the field isn't even registered (defensive guard)", () => {
    const bare = EditorState.create({ doc: "x" });
    expect(tableDisplayAt(bare, 0, 1)).toEqual(DEFAULT_TABLE_DISPLAY);
  });

  it("setTableDisplay overrides one block; tableDisplayAt reads it back", () => {
    const s = st().update({ effects: setTableDisplay.of({ from: 2, to: 6, display: OVERFLOW }) }).state;
    expect(tableDisplayAt(s, 2, 6)).toEqual(OVERFLOW);
    // A different block keeps the default (the override doesn't leak).
    expect(tableDisplayAt(s, 7, 9)).toEqual(DEFAULT_TABLE_DISPLAY);
  });

  it("re-setting a block REPLACES the prior override (no stacking)", () => {
    let s = st();
    s = s.update({ effects: setTableDisplay.of({ from: 2, to: 6, display: OVERFLOW }) }).state;
    s = s.update({
      effects: setTableDisplay.of({ from: 2, to: 6, display: { width: "fit", pin: true } }),
    }).state;
    expect(tableDisplayAt(s, 2, 6)).toEqual({ width: "fit", pin: true });
  });

  it("maps an override through a document edit — the block shifts, the display follows", () => {
    let s = st();
    s = s.update({ effects: setTableDisplay.of({ from: 3, to: 8, display: OVERFLOW }) }).state;
    // Insert 5 chars BEFORE the override → its span slides right by 5.
    s = s.update({ changes: { from: 0, insert: "XXXXX" } }).state;
    expect(tableDisplayAt(s, 8, 13)).toEqual(OVERFLOW);
    // The original coordinates no longer carry it.
    expect(tableDisplayAt(s, 0, 4)).toEqual(DEFAULT_TABLE_DISPLAY);
  });

  it("clearTableDisplays drops every override", () => {
    let s = st();
    s = s.update({ effects: setTableDisplay.of({ from: 2, to: 6, display: OVERFLOW }) }).state;
    expect(tableDisplayAt(s, 2, 6).width).toBe("overflow");
    s = s.update({ effects: clearTableDisplays.of(null) }).state;
    expect(tableDisplayAt(s, 2, 6)).toEqual(DEFAULT_TABLE_DISPLAY);
  });

  it("prunes an override that collapses to zero-length when its table is deleted", () => {
    let s = st();
    s = s.update({ effects: setTableDisplay.of({ from: 2, to: 6, display: OVERFLOW }) }).state;
    expect(tableDisplayAt(s, 2, 6).width).toBe("overflow");
    // Delete exactly the styled span → the override collapses to [2,2); the prune drops it,
    // so a new table later created at that offset can't inherit the stale display (ghost).
    s = s.update({ changes: { from: 2, to: 6, insert: "" } }).state;
    expect(tableDisplayAt(s, 2, 2)).toEqual(DEFAULT_TABLE_DISPLAY);
  });
});
