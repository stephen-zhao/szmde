/**
 * Pure GFM table model (M5, REQ-TBLED-*). Dependency-free — imports NOTHING from
 * `@codemirror/*` or `@lezer/*` — so it is 100%-unit-testable without an EditorView
 * (the count.ts / eol.ts / zoom.ts shape). It owns: parsing a pipe-table source
 * string into a structured model with absolute doc offsets, the structural ops as
 * pure model→model transforms, and serializing a model back to TIDY canonical GFM.
 *
 * WHY parse the raw string (not the lezer tree): the lezer GFM grammar DROPS empty
 * cells — `| a |  | c |` yields TableCell nodes for `a` and `c` only, with two
 * adjacent TableDelimiter where the empty middle cell sits. So a cell's column index
 * CANNOT come from lezer node order; columns must be reconstructed from pipe
 * geometry. `splitRow` does exactly that (one slot per column, empties included),
 * which both makes the model dependency-free and fixes a latent tables.ts bug
 * (it indexed cells/alignment by node position). On-disk format stays portable GFM.
 */

export type Align = "left" | "center" | "right" | null;

/** A table cell: its trimmed display `text`, plus the absolute doc offsets of that
 *  trimmed span (for click→char mapping and targeted edits). Synthesized cells from
 *  the structural ops carry `from===to===0` — they exist only to be re-serialized. */
export interface Cell {
  text: string;
  from: number;
  to: number;
}

export interface TableModel {
  /** Absolute doc offsets of the whole table block. */
  from: number;
  to: number;
  header: Cell[];
  rows: Cell[][];
  aligns: Align[];
  /** Canonical column count = the delimiter row's cell count. */
  colCount: number;
}

const mkCell = (text: string): Cell => ({ text, from: 0, to: 0 });

/**
 * Split one table row into cells by UNESCAPED pipes, emitting one slot per column
 * INCLUDING empties (ports the lezer `parseRow` esc-flag walk). Leading/trailing
 * pipes are optional delimiters, not empty edge cells. `lineStart` is the row's
 * absolute doc offset; each Cell's from/to are the absolute offsets of its trimmed
 * content.
 */
export function splitRow(line: string, lineStart: number): Cell[] {
  const pipes: number[] = [];
  let esc = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (esc) esc = false;
    else if (c === "\\") esc = true;
    else if (c === "|") pipes.push(i);
  }
  // A leading pipe is a delimiter (not an empty first cell) iff only whitespace
  // precedes it; likewise a trailing pipe.
  const lead = pipes.length && line.slice(0, pipes[0]).trim() === "" ? pipes[0] : -1;
  const trail =
    pipes.length && line.slice(pipes[pipes.length - 1] + 1).trim() === ""
      ? pipes[pipes.length - 1]
      : line.length;
  const contentStart = lead >= 0 ? lead + 1 : 0;
  const interior = pipes.filter((p) => p > lead && p < trail);

  const cells: Cell[] = [];
  let segStart = contentStart;
  const bounds = [...interior, trail];
  for (const sep of bounds) {
    const seg = line.slice(segStart, sep);
    const lead2 = seg.length - seg.trimStart().length;
    const text = seg.trim();
    const from = lineStart + segStart + lead2;
    cells.push({ text, from, to: from + text.length });
    segStart = sep + 1;
  }
  return cells;
}

/** Alignment of a delimiter cell like `:--` / `:-:` / `--:` / `---`. */
function alignOf(delim: string): Align {
  const t = delim.trim();
  const l = t.startsWith(":");
  const r = t.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

/**
 * Parse a GFM pipe-table source block into a model. `src` is the table block text
 * (header line, delimiter line, then body lines); `baseOffset` is the absolute doc
 * offset of `src[0]`. Assumes a valid table (≥2 lines: header + delimiter) — callers
 * locate the block via the syntax tree before slicing.
 */
export function parseTable(src: string, baseOffset: number): TableModel {
  const lines = src.split("\n");
  const starts: number[] = [];
  let off = baseOffset;
  for (const ln of lines) {
    starts.push(off);
    off += ln.length + 1; // + the "\n"
  }
  const header = splitRow(lines[0], starts[0]);
  const delim = splitRow(lines[1], starts[1]);
  const aligns = delim.map((c) => alignOf(c.text));
  const rows = lines.slice(2).map((ln, i) => splitRow(ln, starts[i + 2]));
  return {
    from: baseOffset,
    to: baseOffset + src.length,
    header,
    rows,
    aligns,
    colCount: delim.length,
  };
}

// --- Serialization (tidy canonical GFM) ------------------------------------

/** Effective column count = the widest of delimiter / header / any body row, so a
 *  ragged "long" row WIDENS the table rather than dropping cells. */
function effectiveCols(m: TableModel): number {
  return Math.max(m.colCount, m.header.length, ...m.rows.map((r) => r.length));
}

const cellText = (cells: Cell[], i: number): string => cells[i]?.text ?? "";

/** Serialize a model to GFM, FITTED: each cell is its trimmed text with single
 *  spaces — columns are NOT padded to equal widths across rows (per the user's
 *  preference; cells stay fitted to their content). A ragged short row is padded
 *  with empty cells; a long row widens the table. The delimiter is a minimal 3-char
 *  `---` per column with the alignment colons (`:--`/`--:`/`:-:`). */
export function serialize(m: TableModel): string {
  const cols = effectiveCols(m);
  const rowLine = (cells: Cell[]): string => {
    const out: string[] = [];
    for (let i = 0; i < cols; i++) out.push(cellText(cells, i));
    return "| " + out.join(" | ") + " |";
  };
  const delimCell = (i: number): string => {
    const a = m.aligns[i] ?? null;
    return a === "center" ? ":-:" : a === "right" ? "--:" : a === "left" ? ":--" : "---";
  };
  const delimLine = "| " + Array.from({ length: cols }, (_, i) => delimCell(i)).join(" | ") + " |";
  return [rowLine(m.header), delimLine, ...m.rows.map(rowLine)].join("\n");
}

/** Re-tidy a table source string (parse → serialize). Idempotent. */
export function tidy(src: string): string {
  return serialize(parseTable(src, 0));
}

// --- Structural ops (pure model→model) -------------------------------------
// Each returns a NEW model; offsets on synthesized cells are 0 (the result is meant
// to be serialized, then re-parsed for rendering). Indices are clamped, never thrown.

const clamp = (i: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, i));
const emptyRow = (n: number): Cell[] => Array.from({ length: n }, () => mkCell(""));

/** Insert an empty body row BEFORE body-row `index` (use rows.length to append). */
export function insertRow(m: TableModel, index: number): TableModel {
  const at = clamp(index, 0, m.rows.length);
  const rows = m.rows.slice();
  rows.splice(at, 0, emptyRow(effectiveCols(m)));
  return { ...m, rows };
}

/** Delete body row `index`. */
export function deleteRow(m: TableModel, index: number): TableModel {
  if (index < 0 || index >= m.rows.length) return m;
  const rows = m.rows.slice();
  rows.splice(index, 1);
  return { ...m, rows };
}

/** Insert an empty column BEFORE column `index` (use colCount to append). */
export function insertCol(m: TableModel, index: number): TableModel {
  const cols = effectiveCols(m);
  const at = clamp(index, 0, cols);
  const splice = (cells: Cell[]): Cell[] => {
    const padded = cells.slice();
    while (padded.length < cols) padded.push(mkCell(""));
    padded.splice(at, 0, mkCell(""));
    return padded;
  };
  const aligns = m.aligns.slice();
  while (aligns.length < cols) aligns.push(null);
  aligns.splice(at, 0, null);
  return {
    ...m,
    header: splice(m.header),
    rows: m.rows.map(splice),
    aligns,
    colCount: cols + 1,
  };
}

/** Delete column `index`. */
export function deleteCol(m: TableModel, index: number): TableModel {
  const cols = effectiveCols(m);
  if (index < 0 || index >= cols) return m;
  const drop = (cells: Cell[]): Cell[] => {
    const padded = cells.slice();
    while (padded.length < cols) padded.push(mkCell(""));
    padded.splice(index, 1);
    return padded;
  };
  const aligns = m.aligns.slice();
  while (aligns.length < cols) aligns.push(null);
  aligns.splice(index, 1);
  return {
    ...m,
    header: drop(m.header),
    rows: m.rows.map(drop),
    aligns,
    colCount: Math.max(1, cols - 1),
  };
}

const moveItem = <T>(arr: T[], from: number, to: number): T[] => {
  const a = arr.slice();
  const [item] = a.splice(from, 1);
  a.splice(to, 0, item);
  return a;
};

/** Move body row `from` to position `to`. No-op if either is out of range. */
export function moveRow(m: TableModel, from: number, to: number): TableModel {
  const n = m.rows.length;
  if (from < 0 || from >= n || to < 0 || to >= n) return m;
  return { ...m, rows: moveItem(m.rows, from, to) };
}

/** Move column `from` to position `to` (header + every body row + aligns together). */
export function moveCol(m: TableModel, from: number, to: number): TableModel {
  const cols = effectiveCols(m);
  if (from < 0 || from >= cols || to < 0 || to >= cols) return m;
  const padMove = (cells: Cell[]): Cell[] => {
    const padded = cells.slice();
    while (padded.length < cols) padded.push(mkCell(""));
    return moveItem(padded, from, to);
  };
  const aligns = m.aligns.slice();
  while (aligns.length < cols) aligns.push(null);
  return {
    ...m,
    header: padMove(m.header),
    rows: m.rows.map(padMove),
    aligns: moveItem(aligns, from, to),
  };
}

/** Set column `index`'s alignment. */
export function setColAlign(m: TableModel, index: number, align: Align): TableModel {
  const cols = effectiveCols(m);
  if (index < 0 || index >= cols) return m;
  const aligns = m.aligns.slice();
  while (aligns.length < cols) aligns.push(null);
  aligns[index] = align;
  return { ...m, aligns };
}

/**
 * Toggle the header row on/off — LOSSLESS, staying within valid GFM. A GFM pipe table
 * always has a structural header row, so "off" is a BLANK header (never a removed row):
 *   - HEADER PRESENT (any non-blank header cell) → OFF: demote the header into a new FIRST
 *     body row and blank the header, so the old header text becomes ordinary data (nothing
 *     is discarded) and the table renders with an empty header.
 *   - HEADER BLANK (every cell empty) → ON: promote the first body row up into the header
 *     (removed from the body). A blank header with no body row has nothing to promote → no-op
 *     (returns the same reference, so command/menu callers treat it as a pass-through).
 * Off-then-on round-trips to the original (REQ-TBLED-2). Wired to a command + the right-click
 * menu (M5 S7); the on-disk file stays portable GFM either way (open question #1, resolved
 * 2026-06-30: blank the header within GFM).
 */
export function toggleHeader(m: TableModel): TableModel {
  const cols = effectiveCols(m);
  const pad = (cells: Cell[]): Cell[] => {
    const out = cells.slice();
    while (out.length < cols) out.push(mkCell(""));
    return out;
  };
  if (m.header.some((c) => c.text.trim() !== "")) {
    // OFF: demote the populated header into the first body row, blank the header.
    return { ...m, header: emptyRow(cols), rows: [pad(m.header), ...m.rows] };
  }
  // ON: promote the first body row into the blank header (nothing to promote → no-op).
  if (m.rows.length === 0) return m;
  return { ...m, header: pad(m.rows[0]), rows: m.rows.slice(1) };
}

/** Build an empty `rows`×`cols` table model (row 0 is the header). For REQ-TBLED-1. */
export function makeTable(rows: number, cols: number): TableModel {
  const r = Math.max(1, rows);
  const c = Math.max(1, cols);
  return {
    from: 0,
    to: 0,
    header: emptyRow(c),
    rows: Array.from({ length: r - 1 }, () => emptyRow(c)),
    aligns: Array.from({ length: c }, () => null),
    colCount: c,
  };
}

// --- Inline tokenization (shared by the cell renderer + click→source mapping) ----
// A small, non-nested inline tokenizer for cell content. Shared by tables.ts's
// renderInlineMarkdown (DOM) and renderedOffsetToSource (click mapping) so the two
// never drift — and pure, so the source-offset math is 100%-unit-testable.

const INLINE_RE =
  /\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\)/;

/** One inline segment of a cell: a run of RENDERED text and the source offset its
 *  first char comes from (chars within `text` are 1:1 with source from `from`). */
export interface InlineToken {
  kind: "text" | "strong" | "em" | "del" | "code" | "link";
  text: string;
  from: number;
  href?: string;
}

/** Tokenize a cell's source into inline segments. `from` offsets are relative to
 *  `src`. Unknown / nested markup falls back to literal text (as the renderer does). */
export function tokenizeInline(src: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = src;
  let base = 0;
  for (let m = INLINE_RE.exec(rest); m; m = INLINE_RE.exec(rest)) {
    if (m.index > 0) tokens.push({ kind: "text", text: rest.slice(0, m.index), from: base });
    let kind: InlineToken["kind"];
    let inner: string;
    let innerStart: number;
    let href: string | undefined;
    if (m[1] !== undefined) [kind, inner, innerStart] = ["strong", m[1], 2];
    else if (m[2] !== undefined) [kind, inner, innerStart] = ["del", m[2], 2];
    else if (m[3] !== undefined) [kind, inner, innerStart] = ["code", m[3], 1];
    else if (m[4] !== undefined) [kind, inner, innerStart] = ["em", m[4], 1];
    else if (m[5] !== undefined) [kind, inner, innerStart] = ["em", m[5], 1];
    else [kind, inner, innerStart, href] = ["link", m[6], 1, m[7]];
    tokens.push({ kind, text: inner, from: base + m.index + innerStart, href });
    base += m.index + m[0].length;
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) tokens.push({ kind: "text", text: rest, from: base });
  return tokens;
}

/** Map a RENDERED character offset within a cell back to the SOURCE offset (relative
 *  to the cell's source), so a click on a rendered glyph inside a formatted cell
 *  (`**b**`, `[t](u)`, …) lands the caret on the matching source char. Past the end
 *  → the source length. */
export function renderedOffsetToSource(src: string, renderedOffset: number): number {
  let rendered = 0;
  for (const t of tokenizeInline(src)) {
    if (renderedOffset < rendered + t.text.length) return t.from + (renderedOffset - rendered);
    rendered += t.text.length;
  }
  return src.length;
}
