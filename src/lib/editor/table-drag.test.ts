import { describe, it, expect, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { indexAt, applyMove } from "./table-drag";
import { parseTable } from "./table-model";

// Pure unit tests for the drag-reorder core (M5 S5, REQ-TBLED-4). The gesture itself
// (pointer capture + getBoundingClientRect) is layout-only and verified live; the two
// pure decisions — which item the pointer is over, and applying the move — are here.

describe("[REQ-TBLED-4] table-drag", () => {
  describe("indexAt — the drop target", () => {
    const spans = [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 20, end: 30 },
    ];
    it("returns the index of the span the pointer is within", () => {
      expect(indexAt(5, spans)).toBe(0);
      expect(indexAt(15, spans)).toBe(1);
      expect(indexAt(25, spans)).toBe(2);
    });
    it("clamps before the first span and past the last", () => {
      expect(indexAt(-100, spans)).toBe(0);
      expect(indexAt(999, spans)).toBe(2);
    });
    it("returns 0 for no spans", () => {
      expect(indexAt(5, [])).toBe(0);
    });
  });

  describe("applyMove — the whole-table replace", () => {
    const m = parseTable("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |", 0);
    const mockView = (dispatch: ReturnType<typeof vi.fn>) => ({ dispatch }) as unknown as EditorView;

    it("dispatches a column move (header + every row + delimiter together)", () => {
      const dispatch = vi.fn();
      expect(applyMove(mockView(dispatch), m, "col", 0, 2)).toBe(true);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][0].changes.insert).toBe(
        "| b | c | a |\n| --- | --- | --- |\n| 2 | 3 | 1 |\n| 5 | 6 | 4 |",
      );
    });
    it("dispatches a row move", () => {
      const dispatch = vi.fn();
      expect(applyMove(mockView(dispatch), m, "row", 0, 1)).toBe(true);
      expect(dispatch.mock.calls[0][0].changes.insert).toBe(
        "| a | b | c |\n| --- | --- | --- |\n| 4 | 5 | 6 |\n| 1 | 2 | 3 |",
      );
    });
    it("no-ops (false, no dispatch) when source === target", () => {
      const dispatch = vi.fn();
      expect(applyMove(mockView(dispatch), m, "row", 1, 1)).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    });
    it("no-ops when the target is out of range", () => {
      const dispatch = vi.fn();
      expect(applyMove(mockView(dispatch), m, "col", 0, 99)).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
