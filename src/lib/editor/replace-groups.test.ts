import { describe, expect, it } from "vitest";
import { toDollarGroups } from "./replace-groups";

describe("[REQ-FR-2] toDollarGroups — backslash capture refs → dollar form", () => {
  it("converts a single \\1 to $1", () => {
    expect(toDollarGroups("\\1")).toBe("$1");
  });

  it("converts multi-digit \\12 to $12", () => {
    expect(toDollarGroups("\\12")).toBe("$12");
  });

  it("converts several refs in one string", () => {
    expect(toDollarGroups("\\1-\\2/\\3")).toBe("$1-$2/$3");
  });

  it("leaves \\n \\r \\t escapes alone (CM handles those)", () => {
    expect(toDollarGroups("a\\nb\\tc\\rd")).toBe("a\\nb\\tc\\rd");
  });

  it("treats an escaped backslash before a digit as a literal, not a group ref", () => {
    // "\\1" (escaped backslash, then 1) must NOT become a group ref.
    expect(toDollarGroups("\\\\1")).toBe("\\\\1");
  });

  it("mixes an escaped backslash and a real ref", () => {
    expect(toDollarGroups("\\\\\\1")).toBe("\\\\$1"); // \\ (literal) + \1 (ref)
  });

  it("leaves existing $-form and plain text unchanged", () => {
    expect(toDollarGroups("$1 and text")).toBe("$1 and text");
    expect(toDollarGroups("")).toBe("");
  });
});
