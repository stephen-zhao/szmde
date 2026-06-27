import { describe, expect, it } from "vitest";
import { detectEol, fromLf, toLf } from "./eol";

describe("[REQ-EOL-1] detectEol", () => {
  it("detects LF", () => expect(detectEol("a\nb\nc")).toBe("lf"));
  it("detects CRLF", () => expect(detectEol("a\r\nb\r\nc")).toBe("crlf"));
  it("detects mixed", () => expect(detectEol("a\r\nb\nc")).toBe("mixed"));
  it("defaults to LF with no line endings", () => expect(detectEol("abc")).toBe("lf"));
  it("defaults to LF for empty text", () => expect(detectEol("")).toBe("lf"));
});

describe("[REQ-EOL-1] toLf", () => {
  it("converts CRLF to LF", () => expect(toLf("a\r\nb")).toBe("a\nb"));
  it("converts lone CR to LF", () => expect(toLf("a\rb")).toBe("a\nb"));
  it("leaves LF unchanged", () => expect(toLf("a\nb")).toBe("a\nb"));
});

describe("[REQ-EOL-1] fromLf", () => {
  it("LF stays LF", () => expect(fromLf("a\nb", "lf")).toBe("a\nb"));
  it("LF becomes CRLF", () => expect(fromLf("a\nb", "crlf")).toBe("a\r\nb"));
  it("round-trips toLf(fromLf) === identity on LF", () =>
    expect(toLf(fromLf("a\nb\n", "crlf"))).toBe("a\nb\n"));
});
