import { describe, expect, it } from "vitest";
import { countText } from "./count";

describe("[REQ-COUNT-1] countText", () => {
  it("is zero for empty / whitespace-only text", () => {
    expect(countText("")).toEqual({ words: 0, chars: 0 });
    expect(countText("   \n\t ")).toEqual({ words: 0, chars: 5 }); // 3 spaces + tab + space; \n excluded
  });

  it("counts plain prose", () => {
    expect(countText("hello world")).toEqual({ words: 2, chars: 11 });
  });

  it("collapses multiple spaces for words but keeps them in the char count", () => {
    expect(countText("  a  b  ")).toEqual({ words: 2, chars: 8 });
  });

  it("excludes line breaks (LF and CRLF) from the char count", () => {
    expect(countText("line1\nline2")).toEqual({ words: 2, chars: 10 });
    expect(countText("a\r\nb")).toEqual({ words: 2, chars: 2 });
  });

  it("treats apostrophes and hyphens as inside a single word", () => {
    expect(countText("don't well-known")).toEqual({ words: 2, chars: 16 });
  });

  it("counts an emoji/astral char as one character (code points, not UTF-16 units)", () => {
    expect(countText("a😀b")).toEqual({ words: 2, chars: 3 });
  });

  it("counts the raw markdown buffer (markers included in chars; render-mode independent)", () => {
    // '#' + ' ' + 'H' + 'i' = 4 chars; "Hi" = 1 word. The count never depends on
    // how markers are rendered — it's computed from the literal document text.
    expect(countText("# Hi")).toEqual({ words: 1, chars: 4 });
  });

  it("counts numbers as words", () => {
    expect(countText("there are 1234 items")).toEqual({ words: 4, chars: 20 });
  });
});
