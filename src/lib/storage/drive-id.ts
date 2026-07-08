/**
 * Parse a Google Drive file id from a pasted share link or a bare id — the
 * open-by-URL/ID MVP for cloud open (REQ-CLOUD-1; the full Drive file browser via
 * `files.list` is a later slice). Recognized shapes:
 *   https://drive.google.com/file/d/<ID>/view      → <ID>
 *   https://docs.google.com/document/d/<ID>/edit    → <ID>
 *   https://drive.google.com/open?id=<ID>           → <ID>
 *   https://drive.google.com/uc?id=<ID>&export=...  → <ID>
 *   <ID>                                            → <ID>  (already a bare id)
 * Anything without a recognizable pattern is returned trimmed, assumed to be an id.
 */
export function parseDriveId(input: string): string {
  const s = input.trim();
  const dPath = /\/d\/([A-Za-z0-9_-]+)/.exec(s); // .../d/<id>/...
  if (dPath) return dPath[1];
  const idParam = /[?&]id=([A-Za-z0-9_-]+)/.exec(s); // ...?id=<id> / &id=<id>
  if (idParam) return idParam[1];
  return s;
}
