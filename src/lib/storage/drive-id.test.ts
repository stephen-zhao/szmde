import { describe, expect, it } from "vitest";
import { parseDriveId } from "./drive-id";

describe("[REQ-CLOUD-1] parseDriveId", () => {
  it("extracts the id from a /file/d/<id>/view link", () => {
    expect(parseDriveId("https://drive.google.com/file/d/1AbC_def-123/view?usp=sharing")).toBe(
      "1AbC_def-123",
    );
  });

  it("extracts the id from a docs /document/d/<id>/edit link", () => {
    expect(parseDriveId("https://docs.google.com/document/d/XyZ987/edit")).toBe("XyZ987");
  });

  it("extracts the id from an open?id=<id> link", () => {
    expect(parseDriveId("https://drive.google.com/open?id=ID_abc123")).toBe("ID_abc123");
  });

  it("extracts the id from a uc?export=download&id=<id> link", () => {
    expect(parseDriveId("https://drive.google.com/uc?export=download&id=fileXYZ")).toBe("fileXYZ");
  });

  it("returns a bare id unchanged", () => {
    expect(parseDriveId("1AbC_def-123")).toBe("1AbC_def-123");
  });

  it("trims surrounding whitespace", () => {
    expect(parseDriveId("  abc123  ")).toBe("abc123");
  });

  it("prefers the /d/ path form over a trailing query", () => {
    expect(parseDriveId("https://drive.google.com/file/d/MAIN/view?id=OTHER")).toBe("MAIN");
  });
});
