import { describe, it, expect } from "vitest";
import {
  splitRow,
  parseTable,
  serialize,
  tidy,
  insertRow,
  deleteRow,
  insertCol,
  deleteCol,
  moveRow,
  moveCol,
  setColAlign,
  toggleHeader,
  makeTable,
  tokenizeInline,
  renderedOffsetToSource,
  type TableModel,
} from "./table-model";

// A canonical already-tidy 2×2 table (header + one body row). FITTED style: cells
// sized to content, single spaces, NOT column-padded — used as the round-trip fixture.
const T = "| a | b |\n| --- | --- |\n| 1 | 2 |";

describe("[REQ-TBLED-6] splitRow — pipe geometry, empties included", () => {
  it("splits a pipe-delimited row into trimmed cells with absolute offsets", () => {
    const cells = splitRow("| ab | cd |", 0);
    expect(cells.map((c) => c.text)).toEqual(["ab", "cd"]);
    // "| ab | cd |": 'ab' at index 2, 'cd' at index 7
    expect(cells[0]).toMatchObject({ from: 2, to: 4 });
    expect(cells[1]).toMatchObject({ from: 7, to: 9 });
  });

  it("PRESERVES an empty middle cell (lezer drops it — the bug this guards)", () => {
    const cells = splitRow("| a |  | c |", 0);
    expect(cells.map((c) => c.text)).toEqual(["a", "", "c"]);
    expect(cells.length).toBe(3); // the empty slot is NOT dropped
  });

  it("preserves a trailing empty cell", () => {
    expect(splitRow("| a |  |", 0).map((c) => c.text)).toEqual(["a", ""]);
  });

  it("handles a row with NO edge pipes", () => {
    expect(splitRow("a | b", 0).map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("treats an escaped \\| as one cell, not a separator", () => {
    const cells = splitRow("| a \\| b |", 0);
    expect(cells.length).toBe(1);
    expect(cells[0].text).toBe("a \\| b");
  });

  it("a string with no pipes is a single cell", () => {
    expect(splitRow("abc", 0).map((c) => c.text)).toEqual(["abc"]);
  });

  it("offsets are relative to lineStart", () => {
    expect(splitRow("| x |", 100)[0].from).toBe(102);
  });
});

describe("[REQ-TBLED-6] parseTable", () => {
  it("parses header, delimiter aligns, body rows + colCount", () => {
    const m = parseTable("| a | b |\n| :-- | --: |\n| 1 | 2 |\n| 3 | 4 |", 0);
    expect(m.header.map((c) => c.text)).toEqual(["a", "b"]);
    expect(m.rows.map((r) => r.map((c) => c.text))).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(m.aligns).toEqual(["left", "right"]);
    expect(m.colCount).toBe(2);
  });

  it("parses all four alignments", () => {
    const m = parseTable("| a | b | c | d |\n| :-: | --: | :-- | --- |\n| 1 | 2 | 3 | 4 |", 0);
    expect(m.aligns).toEqual(["center", "right", "left", null]);
  });

  it("records absolute block + cell offsets with baseOffset", () => {
    const src = "| a | b |\n| - | - |";
    const m = parseTable(src, 50);
    expect(m.from).toBe(50);
    expect(m.to).toBe(50 + src.length);
    expect(m.header[0].from).toBe(52); // 50 + index of 'a'
  });

  it("handles a header-only table (no body rows)", () => {
    const m = parseTable("| a | b |\n| - | - |", 0);
    expect(m.rows).toEqual([]);
    expect(m.colCount).toBe(2);
  });
});

describe("[REQ-TBLED-6] serialize / tidy", () => {
  it("round-trips an already-tidy table unchanged (idempotent)", () => {
    expect(tidy(T)).toBe(T);
    expect(tidy(tidy(T))).toBe(tidy(T));
  });

  it("keeps cells FITTED to content (no column-width padding)", () => {
    const out = tidy("|  name | x |\n|-|-|\n| alice |   1 |");
    expect(out).toBe("| name | x |\n| --- | --- |\n| alice | 1 |");
  });

  it("normalizes the delimiter with alignment colons", () => {
    const m = parseTable("| a | b | c |\n| :-: | --: | :-- |\n| 1 | 2 | 3 |", 0);
    const out = serialize(m).split("\n")[1];
    expect(out).toBe("| :-: | --: | :-- |");
  });

  it("pads a ragged SHORT body row to colCount with empty cells", () => {
    const out = tidy("| a | b |\n| - | - |\n| x |");
    expect(out).toBe("| a | b |\n| --- | --- |\n| x |  |");
  });

  it("WIDENS the table for a ragged LONG body row (never drops cells)", () => {
    const out = tidy("| a | b |\n| - | - |\n| 1 | 2 | 3 |");
    const lines = out.split("\n");
    expect(lines[0]).toBe("| a | b |  |"); // header widened with a 3rd empty col
    expect(lines[1]).toBe("| --- | --- | --- |");
    expect(lines[2]).toBe("| 1 | 2 | 3 |");
  });
});

// Build a model directly for op edge cases (offsets irrelevant to serialize).
const model = (src: string): TableModel => parseTable(src, 0);

describe("[REQ-TBLED-3] insert/delete rows", () => {
  it("inserts an empty row at an index", () => {
    expect(serialize(insertRow(model(T), 0))).toBe(
      "| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |",
    );
  });
  it("appends when index === rows.length", () => {
    const m = model(T);
    expect(serialize(insertRow(m, m.rows.length)).split("\n").length).toBe(4);
  });
  it("clamps an out-of-range insert index (negative → front, huge → end)", () => {
    expect(serialize(insertRow(model(T), -5)).split("\n")[2]).toBe("|  |  |");
    expect(serialize(insertRow(model(T), 99)).split("\n").length).toBe(4);
  });
  it("deletes a body row", () => {
    expect(serialize(deleteRow(model(T), 0))).toBe("| a | b |\n| --- | --- |");
  });
  it("is a no-op for an out-of-range delete index", () => {
    expect(deleteRow(model(T), -1)).toEqual(model(T));
    expect(deleteRow(model(T), 9)).toEqual(model(T));
  });
});

describe("[REQ-TBLED-3] insert/delete columns", () => {
  it("inserts an empty column at an index (header + delimiter + every row)", () => {
    const out = serialize(insertCol(model("| a | b |\n| - | - |\n| 1 | 2 |"), 1));
    expect(out).toBe("| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |");
  });
  it("pads a ragged short row before inserting a column", () => {
    const out = serialize(insertCol(model("| a | b |\n| - | - |\n| x |"), 2));
    expect(out.split("\n")[2]).toBe("| x |  |  |");
  });
  it("deletes a column from header + delimiter + every row", () => {
    const out = serialize(deleteCol(model("| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |"), 1));
    expect(out).toBe("| a | c |\n| --- | --- |\n| 1 | 3 |");
  });
  it("is a no-op for an out-of-range column delete", () => {
    const m = model(T);
    expect(deleteCol(m, 9)).toEqual(m);
    expect(deleteCol(m, -1)).toEqual(m);
  });
  it("floors colCount at 1 when deleting the last column", () => {
    expect(deleteCol(model("| a |\n| - |\n| 1 |"), 0).colCount).toBe(1);
  });
});

describe("[REQ-TBLED-4] move rows/columns", () => {
  it("reorders body rows", () => {
    const out = serialize(moveRow(model("| a | b |\n| - | - |\n| 1 | x |\n| 2 | y |"), 0, 1));
    expect(out.split("\n").slice(2)).toEqual(["| 2 | y |", "| 1 | x |"]);
  });
  it("is a no-op for an out-of-range row move", () => {
    const m = model(T);
    expect(moveRow(m, 5, 0)).toEqual(m);
    expect(moveRow(m, 0, 5)).toEqual(m);
  });
  it("reorders a column across header + delimiter + every row", () => {
    const out = serialize(moveCol(model("| a | b |\n| :-- | --: |\n| 1 | 2 |"), 0, 1));
    expect(out).toBe("| b | a |\n| --: | :-- |\n| 2 | 1 |");
  });
  it("is a no-op for an out-of-range column move", () => {
    const m = model(T);
    expect(moveCol(m, 5, 0)).toEqual(m);
    expect(moveCol(m, 0, 5)).toEqual(m);
  });
  it("pads ragged rows/aligns when moving a column on a widened table", () => {
    // long body row widens to 3 cols; aligns (2) get padded before the move
    const out = serialize(moveCol(model("| a | b |\n| - | - |\n| 1 | 2 | 3 |"), 0, 2));
    expect(out.split("\n")[2]).toBe("| 2 | 3 | 1 |");
  });
});

describe("[REQ-TBLED-6] setColAlign", () => {
  it("sets a column's alignment", () => {
    expect(serialize(setColAlign(model(T), 1, "center")).split("\n")[1]).toBe("| --- | :-: |");
  });
  it("is a no-op for an out-of-range column", () => {
    const m = model(T);
    expect(setColAlign(m, 9, "left")).toEqual(m);
  });
  it("widens aligns when the table was widened before aligning", () => {
    const out = serialize(setColAlign(model("| a | b |\n| - | - |\n| 1 | 2 | 3 |"), 2, "right"));
    expect(out.split("\n")[1]).toBe("| --- | --- | --: |");
  });
});

describe("[REQ-TBLED-2] toggleHeader", () => {
  it("blanks the header cells (stays valid GFM)", () => {
    const out = serialize(toggleHeader(model(T)));
    expect(out.split("\n")[0]).toBe("|  |  |");
    expect(out.split("\n").length).toBe(3); // still header + delimiter + body
  });
});

describe("[REQ-TBLED-1] makeTable", () => {
  it("builds an empty rows×cols table (row 0 = header)", () => {
    expect(serialize(makeTable(2, 3))).toBe("|  |  |  |\n| --- | --- | --- |\n|  |  |  |");
  });
  it("round-trips via parseTable", () => {
    const out = serialize(makeTable(3, 2));
    expect(tidy(out)).toBe(out);
  });
  it("clamps rows/cols to a minimum of 1", () => {
    expect(serialize(makeTable(0, 0))).toBe("|  |\n| --- |");
  });
});

describe("[REQ-TBLED-7] inline tokenizer + click→source mapping", () => {
  const tup = (s: string) => tokenizeInline(s).map((t) => [t.kind, t.text, t.from]);

  it("tokenizes plain text + a bold construct with source offsets", () => {
    expect(tup("a **b** c")).toEqual([
      ["text", "a ", 0],
      ["strong", "b", 4],
      ["text", " c", 7],
    ]);
  });

  it("covers del / code / em(*) / em(_) / link", () => {
    expect(tup("~~s~~")).toEqual([["del", "s", 2]]);
    expect(tup("`c`")).toEqual([["code", "c", 1]]);
    expect(tup("*i*")).toEqual([["em", "i", 1]]);
    expect(tup("_u_")).toEqual([["em", "u", 1]]);
    const link = tokenizeInline("[t](http://x)")[0];
    expect([link.kind, link.text, link.from, link.href]).toEqual(["link", "t", 1, "http://x"]);
  });

  it("plain text is a single token", () => {
    expect(tup("plain")).toEqual([["text", "plain", 0]]);
  });

  it("maps a rendered offset inside a formatted cell to the source char", () => {
    // rendered "a b c"; the 'b' is rendered index 2 → source index 4 (inside **b**).
    expect(renderedOffsetToSource("a **b** c", 0)).toBe(0); // 'a'
    expect(renderedOffsetToSource("a **b** c", 2)).toBe(4); // 'b'
    expect(renderedOffsetToSource("a **b** c", 4)).toBe(8); // 'c'
  });

  it("a rendered offset past the end maps to the source end", () => {
    expect(renderedOffsetToSource("ab", 9)).toBe(2);
  });
});
