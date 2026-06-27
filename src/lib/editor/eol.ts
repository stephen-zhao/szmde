export type Eol = "lf" | "crlf";

/**
 * Detect a file's line ending: "lf", "crlf", or "mixed". CodeMirror stores the
 * buffer as LF internally, so EOL is write-time metadata (SPEC §4.4) — we detect
 * it on open and re-apply it on save.
 */
export function detectEol(text: string): Eol | "mixed" {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      if (i > 0 && text.charCodeAt(i - 1) === 13 /* \r */) crlf++;
      else lf++;
    }
  }
  if (crlf > 0 && lf > 0) return "mixed";
  if (crlf > 0) return "crlf";
  return "lf";
}

/** Normalize any line endings (CRLF / lone CR) to LF, for the editor buffer. */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Serialize an LF buffer to the given EOL, for writing to disk. */
export function fromLf(text: string, eol: Eol): string {
  return eol === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}
