import { describe, it, expect } from "vitest";
import { indexAt } from "./table-drag";

// Pure unit test for the drag-reorder drop target (M5 S5, REQ-TBLED-4). The gesture
// (pointer capture + getBoundingClientRect) is layout-only and verified live; the move
// itself is applied via table-ops.replaceTable (covered in table-ops.dom.test.ts).

describe("[REQ-TBLED-4] indexAt — the drop target", () => {
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
