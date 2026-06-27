/**
 * Save-conflict resolution helpers (REQ-SAVE-1, SPEC §6). The *detection* lives
 * in each provider's `write` (a revision mismatch → StorageError("conflict")).
 * This module holds the pure logic the shell needs to act on the user's choice;
 * the modal itself is shell wiring (covered by an LLM workflow).
 *
 * v1 offers three resolutions: **overwrite** (force-write over their change),
 * **save-copy** (keep both — write our version to a sibling path), and **reload**
 * (discard ours, take theirs). A true 3-way merge view is a documented deferral.
 */
export type ConflictChoice = "overwrite" | "save-copy" | "reload";

/**
 * Derive a "save a copy" path by inserting a `" (copy)"` suffix before the file
 * extension, preserving the directory. `n` (default 1) disambiguates when an
 * earlier copy already exists, so the shell can stat upward until it finds a free
 * name (avoids clobbering a prior copy):
 * - `notes.md`, n=1 → `notes (copy).md`; n=2 → `notes (copy 2).md`
 * - `/home/me/notes.md` → `/home/me/notes (copy).md`
 * - `C:\Users\me\a.txt` → `C:\Users\me\a (copy).txt`
 * - `archive.tar.gz` → `archive.tar (copy).gz` (splits on the last dot)
 * - `README` → `README (copy)` (no extension)
 * - `.gitignore` → `.gitignore (copy)` (leading-dot dotfile has no extension)
 */
export function copyPathFor(path: string, n = 1): string {
  const suffix = n <= 1 ? " (copy)" : ` (copy ${n})`;
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = path.slice(0, sep + 1); // includes the trailing separator, or "" if none
  const name = path.slice(sep + 1);
  const dot = name.lastIndexOf(".");
  // dot <= 0 → no extension, or a leading-dot dotfile: append at the very end.
  if (dot <= 0) return `${dir}${name}${suffix}`;
  return `${dir}${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}
