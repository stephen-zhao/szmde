import { describe, expect, it } from "vitest";
import { copyPathFor } from "./conflict";

describe("[REQ-SAVE-1] copyPathFor — save-a-copy path derivation", () => {
  it("inserts ' (copy)' before the extension of a bare filename", () => {
    expect(copyPathFor("notes.md")).toBe("notes (copy).md");
  });

  it("preserves a POSIX directory", () => {
    expect(copyPathFor("/home/me/notes.md")).toBe("/home/me/notes (copy).md");
  });

  it("preserves a Windows directory", () => {
    expect(copyPathFor("C:\\Users\\me\\a.txt")).toBe("C:\\Users\\me\\a (copy).txt");
  });

  it("splits on the LAST dot (multi-dot names)", () => {
    expect(copyPathFor("archive.tar.gz")).toBe("archive.tar (copy).gz");
  });

  it("appends at the end when there is no extension", () => {
    expect(copyPathFor("README")).toBe("README (copy)");
  });

  it("treats a leading-dot dotfile as having no extension", () => {
    expect(copyPathFor(".gitignore")).toBe(".gitignore (copy)");
  });
});
