# M5 — Rich table editing (implementation plan)

> **📦 Archived — historical planning artifact.** This milestone has shipped; the plan below is
> preserved as **provenance** (why the code is shaped the way it is), **not** current-state tracking.
> For current status see [roadmap.md](../roadmap.md) · [requirements.md](../requirements.md) ·
> [bugs.md](../bugs.md).

_Implementation plan for milestone **M5** (see [roadmap.md](../roadmap.md) "M5" for the
requirement slotting and [SPEC.md](../../SPEC.md) §7.4 / §5.1 for the behavior). SPEC.md is the
"what"; this doc is the "how" — architecture + staged `S1…S7` slices. Same shape as
[m4-plan.md](m4-plan.md). Grounded by a 5-agent parallel design scout + empirical lezer parse
probes (2026-06-29)._

_Status legend: ✅ done · 🔜 next · ⬜ planned._

## Scope (from roadmap "M5")

Rich structured editing of GFM pipe tables. **The on-disk format stays portable GFM pipe
tables** (`| a | b |\n| - | - |\n| 1 | 2 |`); every structural edit is a transaction on that
SOURCE, and the rich `<table>` UI (M2's render-only widget) is a layer over it.

| REQ | Requirement | Slice | Effort |
|-----|-------------|-------|--------|
| REQ-TBLED-6 | Auto-tidy source + per-column alignment serialization (model half) | S1 | M |
| REQ-TBLED-7 | Edit-in-place: caret at clicked char in ANY cell; up/down arrows enter the table | S2 | M |
| REQ-TBLED-3 | Insert/delete rows & columns at any position | S3 | M |
| REQ-TBLED-5 | Cursor-context shortcuts (move/insert/delete current row/col) | S3 | S |
| REQ-TBLED-6 | Per-column alignment UI + tidy command (UI half) | S4 | S |
| REQ-TBLED-4 | Drag to reorder columns/rows | S5 | M |
| REQ-TBLED-1 | Insert an N×M table from scratch (grid picker / command) | S6 | S |
| REQ-TBLED-2 | Toggle the header row on/off | S7 | S |

## Architecture (extends the established editor layering)

Every slice slots into the M1–M4 layering — a dependency-free pure core + thin CM extensions
+ EditorApi callbacks + WF-* for live behavior. The single new top-level concept is a pure
**table model** that owns parse-from-source, structural ops, and serialization.

- **NEW pure core (the `count.ts` / `eol.ts` / `zoom.ts` shape):** `src/lib/editor/table-model.ts`
  — dependency-free (imports **nothing** from `@codemirror/*` or `@lezer/*`), 100%-unit-tested
  (the `lines:100` gate). It owns: `parseTable(src, baseOffset)` → `TableModel`; the structural
  ops (`insertRow`/`deleteRow`/`insertCol`/`deleteCol`/`moveRow`/`moveCol`/`toggleHeader`/
  `setColAlign`/`makeTable`) as pure model→model transforms; `tidy(model)` → canonical GFM
  string; and the click-targeting helpers (`cellAt`, rendered↔source offset map). It carries
  `parseAligns` lifted out of `tables.ts`.
- **`tables.ts` becomes a thin adapter** over the model (it stays the `*.dom.test.ts` layer).
  Today it walks the lezer tree directly and **indexes cells by `getChildren("TableCell")` array
  position — a latent bug**: an empty cell emits NO `TableCell` node (confirmed by probe — see
  Decisions/Risks), so any table with a blank cell mis-assigns alignment and click targets. M5
  refactors `tables.ts` to (a) use lezer ONLY to locate the `Table` block `[from,to]`, then (b)
  `parseTable(state.doc.sliceString(from,to), from)` for the corrected pipe-geometry cell map. The
  hard-won reveal-on-cursor (`tables.ts:184-185`) + `atomicRanges` (`:230`) + `TableWidget.eq`
  plumbing is preserved.
- **New commands module** `src/lib/editor/table-commands.ts`: CM `StateCommand`s that resolve the
  `Table` at the caret (the `listEnterOrExit`/`toggleWrap` `resolveInner`+ancestor-walk idiom),
  call a model op, serialize, and dispatch ONE `{from,to,insert}` replace over the block — then
  re-place the caret in the same logical cell. Bound in `keymap.ts`'s `editingKeymap` (`Prec.high`).
- **Widget affordances inside `TableWidget.toDOM`** (the `tasks.ts`/`alerts.ts` mousedown→dispatch
  idiom, NOT HTML5 `draggable`): per-row/per-col drag grips and alignment controls, rendered inside
  the `<table>` DOM so they vanish on reveal. Pointer events + `setPointerCapture`.
- **EditorApi seam** (`Editor.svelte`): `insertTable(rows, cols)` for the grid picker (REQ-TBLED-1),
  invoked from a `.svelte` toolbar/picker — the `setEmoji`/`getRenderMode` callback shape.
- **WF-* live layer:** real layout / pointer-drag / caret-from-point are happy-dom-untestable.
  Drag (REQ-TBLED-4), formatted-cell click→char (REQ-TBLED-7), and arrows-enter-table get WF
  entries authored BEFORE the fix (TDD-for-interaction); WF-3 is updated (it currently defers them).

The editor stays framework-agnostic: new state flows out via callbacks; `+page.svelte` owns any
toolbar/picker glue.

## Decisions taken (from the scouts; defaults — overridable)

| # | Decision | Choice |
|---|----------|--------|
| **Column indexing** | lezer `TableCell` nodes vs pipe geometry | **Pipe geometry.** Probe-confirmed: `\| a \|  \| c \|` emits `TableCell` for `a`,`c` only — the empty middle cell is two adjacent `TableDelimiter`s, no node. The model re-splits each row by unescaped `\|` (porting lezer `parseRow`), emitting one slot per column **including empties**. Canonical column count = the **delimiter row** count. `tables.ts` cell/alignment indexing by node position is **forbidden** in review. |
| **Parse source** | lezer tree vs raw string | Model parses the **raw source string** (split on unescaped pipes) so it is genuinely dependency-free + unit-testable without an `EditorView`. lezer is used by `tables.ts` ONLY to locate the `Table` block range. |
| **Cell offsets** | relative vs absolute | **Absolute doc offsets** per cell (`baseOffset` added at parse), so ops emit `ChangeSpec`s and REQ-TBLED-7 maps a click to `from + charOffset`. Store BOTH trimmed `text` (display) and raw span (round-trip). |
| **Reshaping serialization** | per-cell diff vs whole-table replace | **Whole-table replace** (`{from:m.from, to:m.to, insert:tidy(m')}`) for ops that re-pad every line (insert/delete/move row/col, tidy). One clean undo step; avoids fiddly splice math. |
| **Bounded serialization** | always-tidy vs targeted | **Targeted single-region `ChangeSpec`** for `setColAlign` (one delimiter cell) and a single in-cell text edit — preserves the caret + manual spacing. Plain typing inside a revealed cell stays a NORMAL CM edit (no model round-trip per keystroke — the M4 "gate recompute" lesson). |
| **Auto-tidy trigger** | every keystroke vs structural-only | Tidy runs on **structural ops + an explicit Tidy command**, never per-keystroke. |
| **Serialize style (REQ-TBLED-6)** | column-aligned vs fitted | **FITTED, no alignment padding** (user, 2026-06-30): each cell is its trimmed text with single spaces (`\| a \| bb \|`), NOT padded to equal column widths across rows. Delimiter = minimal `---`/`:--`/`--:`/`:-:`. "Tidy" therefore = normalize spacing + delimiter, not align. (No code-point width math needed.) |
| **Escaped pipe `\|`** | unescape vs preserve | **Preserved literally** inside the cell (lezer `esc` flag); never re-split, never unescaped. Padding counts the source chars. |
| **Ragged-row overflow** | clamp vs widen vs keep | A short body row is **padded** to colCount; a long body row **widens the whole table** (adds header+delimiter cols) rather than dropping cells — silently clamping would corrupt the file. |
| **Drag mechanism** | HTML5 `draggable` vs pointer | **Pointer events + `setPointerCapture` on explicit grips.** HTML5 DnD fights CM's contenteditable host + `atomicRanges` + WebView2 native DnD. Matches every existing widget handler. |
| **Toggle-header OFF (REQ-TBLED-2)** | no portable GFM headerless table | **Within GFM: blank the header cells** (stays a valid, rendered table). User (2026-06-30) wants truly-headerless tables ALLOWED for OPENING — GFM/lezer won't render those as a `<table>`, but szmde already round-trips them losslessly as literal text (no crash/corruption). Rendering non-GFM headerless tables (MultiMarkdown / Pandoc-grid style) as real tables = a flagged **follow-up** (custom parse), not v1. |
| **Edit affordances (REQ-TBLED-3/4)** | keybindings only vs gizmos+menu | User (2026-06-30): keybindings PLUS **hover gizmos in every mode** + a **right-click context menu** (Formatted). Formatted: insert/delete gizmos appear on cell/row/column EDGES on hover; right-click → insert/delete/move/align menu. Source/Syntax: gizmos appear when hovering the **edge `\|` chars** (insert column) and the **inter-line gaps** (insert row) over the raw pipe source. The source-mode gizmos are a new decoration layer (S3 extends beyond the rendered widget). |
| **Arrow "enter table" (REQ-TBLED-7)** | land in source vs rendered-cell nav | **Land in the SOURCE** at the column under the caret's x (trips the existing reveal). Rendered-cell-to-cell navigation while the table stays rendered is **out of scope v1**. |
| **Post-edit caret** | inside vs outside block | Cursor-context ops (-5) + click (-7) leave the caret **inside** (reveal is desired). Drag (-4) + toolbar ops (-1/-2/-3/-6) place the caret **outside** `[from,to]` so the rendered table updates in place (no flicker-to-pipes). |
| **Insert affordance (REQ-TBLED-1)** | picker vs command | Ship a **command first** (`insertTable`), the grid-picker `.svelte` as the affordance over it. |

## Staged build sequence

> Each slice: **failing test(s) first** (TDD, T4), then implementation, `npm run test` +
> `npm run check` green, update [requirements.md](../requirements.md) with the `REQ-TBLED-*` rows and
> tag tests `[REQ-TBLED-n]`, add the WF-* entry for any live aspect BEFORE the fix, then commit.
> Run an adversarial ("ultracode") review over the substantial slices (S1, S3).

### S1 — Pure table model + parse + serialize/tidy ⬜  (`REQ-TBLED-6` model half)
**The foundation — every other slice writes through `serialize`/`tidy` and reads `parseTable`.**
`table-model.ts` (dependency-free): `interface Cell {text; raw; from; to}`, `interface TableModel
{from; to; header:Cell[]; rows:Cell[][]; aligns:Align[]; colCount}`; `splitRow(line, lineStart)`
porting lezer `parseRow` (toggle `esc` on `\`, split on unescaped `|`, optional leading/trailing
pipe) **always emitting a slot per column**; `parseTable(src, baseOffset)`; `tidy(model)` →
canonical GFM (pad each col to max code-point width, normalize delimiter to `---`/`:--`/`:-:`/
`--:`, pad ragged rows, widen on overflow). Lift `parseAligns` here; `tables.ts` re-imports it.
**Tests** (`table-model.test.ts`, target 100%): clean 2×2 round-trips identical; **mid-row + trailing
EMPTY cell preserved** (the probe regression — slots not dropped); ragged short row pads, long row
widens; leading/trailing-pipe + no-edge-pipe variants; `\|` stays one cell + survives a tidy
round-trip; all four aligns parse/serialize; `tidy` idempotent (`tidy(tidy(x))===tidy(x)`);
1-col + header-only tables; `setColAlign` never emits a delimiter that fails the GFM delimiter regex.
Ships with NO UI change — provably-correct model first. **Refactor `tables.ts`** to call
`parseTable` (fixes the empty-cell render bug); re-verify `table.dom.test.ts`.

### S2 — Targeting: click→exact char (incl. formatted) + arrows enter table ⬜  (`REQ-TBLED-7`)
Deferred from M2. Two halves: (a) **formatted-cell mapping** — a pure
`renderedOffsetToSource(cellSrc, renderedOffset)` walks the SAME `INLINE_RE` tokenizer
`renderInlineMarkdown` uses, accumulating source-vs-rendered lengths, so a click on rendered `b`
inside `**b**` maps to the source index of `b`. Render cell segments with `data-seg-from` so the
live `mousedown` resolves `closest('[data-seg-from]')` + a 1:1 in-segment offset (the `alerts.ts`
precedent). (b) **arrow entry** — `ArrowDown`/`ArrowUp` `StateCommand`s in `editingKeymap`: when the
caret is on the line adjacent to a rendered `Table`, compute the target column from `coordsAtPos` vs
header-cell `getBoundingClientRect`, dispatch a cursor into that cell's source `from` (trips reveal).
**Tests:** PURE unit for `renderedOffsetToSource` across plain/`**b**`/`` `c` ``/`[t](u)`/mixed (this
is what WF-3's deferred note becomes) + `cellAt(model, offset)` incl. empty cell; DOM: ArrowDown from
the line above lands `selection.head` inside the table. **WF (update WF-3):** click the 3rd glyph of a
bold cell → caret on the matching source char; ArrowDown/Up cross the table boundary live. The
`caretPositionFromPoint` hop stays `/* v8 ignore */` live-only; the offset MATH is unit-covered.

### S3 — Insert/delete row & col + cursor-context shortcuts ✅  (`REQ-TBLED-3`, `REQ-TBLED-5`)
Pure ops built+tested in S1. `table-commands.ts`: `StateCommand`s resolving the `Table` at the caret
(`resolveInner`+walk; `return false` to pass the key through when not in a table) → model op →
serialize → ONE replace over `[m.from, m.to]` → re-place caret in the same logical cell. Bindings
(non-colliding with `Enter`/`Tab`/`Mod-b`/`Mod-i`/`Mod-Shift-m`/`Mod-.`): `Alt-Shift-Down`/`Up` move
row, `Alt-Shift-Right`/`Left` move col, `Mod-Enter`/`Mod-Shift-Enter` insert row below/above, plus
insert/delete-col variants. Row/col +/- handle elements in `TableWidget.toDOM` (`data-row`/`data-col`).
**Tests:** PURE ops green from S1; DOM: a dispatched `insertRowAfter`/`deleteCol` mutates `state.doc`
to the expected tidy GFM string + delimiter colCount stays consistent (empty-cell-safe); widget renders
N row-handles + M col-handles. Integration (`editing.test.ts` pattern): caret in a cell, dispatch the
keydown, assert resulting doc + caret cell. Edge tests (the off-by-one lesson): delete last column,
delete header-adjacent row, insert into a header-only table. **WF:** handle buttons fire at the right
position; physical keys reach the commands.

### S3b — Edit affordances: right-click menu ✅ + Formatted hover gizmos ✅  (`REQ-TBLED-3`/`-5`/`-6`)
**Right-click context menu (`table-menu.ts`):** in Formatted mode, right-clicking any rendered cell
opens `showTableMenu` — every structural op for that cell's row + column (insert/delete row,
insert/delete column, move row/column, per-column alignment). Each op is a whole-table replace via the
pure model; the caret is NOT moved, so it stays outside the block and the `<table>` updates in place (no
reveal flicker). Dismisses on outside-click/Escape; viewport-clamped (live-only, v8-ignored). The menu is
appended into `view.dom` so the `EditorView.theme` rules reach it.
**Formatted hover "+" gizmos (`tables.ts`):** column-insert handles on the header strip (right edge of
each header cell + a leading-column handle on the first), row-insert handles in the left gutter (bottom
edge of each first-column cell; the header's adds the first body row). Absolutely-positioned buttons,
hidden + `pointer-events:none` until cell hover; the "+" is a CSS `::before` (out of cell textContent);
`tabindex -1`. Same in-place whole-table replace.
**Review note:** two adversarial reviews ran; the **right-click must not move the caret** (a right-click's
mousedown fires before contextmenu) and the **gizmo mousedown must ignore non-primary buttons** were both
caught + fixed (`if (e.button !== 0) return;`), with regression tests.

### S3c — Source/Syntax-mode insert gizmos ✅  (`REQ-TBLED-3`)
`table-source-gizmos.ts` — a `ViewPlugin` (gated to non-Clean modes) providing widget decorations over
the raw pipe text: **column** handles on the header row's pipe chars (leading pipe → col 0; each
subsequent pipe → that boundary), **row** handles at each table line's right edge (header → first body
row; body row → below; delimiter skipped). Zero-width anchor (no text shift) + absolute "+" button;
primary-mousedown re-resolves the `Table` at click time (robust to intervening edits) → one whole-table
replace via the pure ops. The same edits are already keymap-reachable in every mode; these are the mouse
affordances. 10 DOM tests (incl. re-resolve-after-edit); verified live in Source mode.

### S4 — Per-column alignment UI + tidy command ✅  (`REQ-TBLED-6` UI half)
**Alignment UI** shipped via the S3b right-click menu (Align left/center/right/clear on the clicked
column → `setColAlign` → whole-table replace). **`tidyTable`** (`table-commands.ts`) re-serializes the
table at the caret to canonical fitted GFM; bound to `Mod-Alt-t` (inert outside a table; returns false
when already tidy). Verified live in Source mode. (Original plan below — the alignment-cycle-on-the-handle
idea was superseded by the menu's discrete align items + the source-mode gizmos.)
`setColAlign`/`tidy` pure (S1). Alignment control in the column handle cycling `:--`/`:-:`/`--:`
(targeted single-region `ChangeSpec` on the one delimiter cell). An explicit Tidy command (whole-table
replace). **Tests:** PURE re-asserted (delimiter cell correct, tidy idempotent); DOM: clicking the
alignment affordance mutates `state.doc`'s delimiter row + the rendered `th/td` `style.textAlign`
updates (reuses the proven `parseAligns`→`textAlign` path). **WF:** alignment toggle + monospace tidy
look right (column widths are layout — happy-dom can't judge).

### S5 — Drag to reorder rows/columns ✅  (`REQ-TBLED-4`)
**Shipped (`table-drag.ts` + `tables.ts`):** dotted drag grips on hover — top of each header cell
(column), left of each body row's first cell (row). A primary-button drag pointer-captures, hit-tests the
row/column under the pointer via the pure `indexAt`, tints the drop target (`.cm-tbl-drop`), and on
release calls `applyMove` → `moveRow`/`moveCol` → one whole-table replace (caret outside → in-place). The
pure `indexAt`/`applyMove` are unit-tested (7 tests); the pointer gesture is `v8 ignore` (layout-only) and
verified LIVE (row + column drags reorder with the drop highlight; `setPointerCapture` wrapped so a
synthetic/no-active-pointer drag still tracks). Original plan ⬇:
`moveRow`/`moveCol` pure (S1). Pointer-based grips in `TableWidget.toDOM`: `pointerdown`
(preventDefault, `setPointerCapture`, record source index) → `pointermove` (hit-test other grips →
drop index + indicator) → `pointerup` (dispatch the move; caret OUTSIDE the block so the table stays
rendered). **Tests:** PURE move ops covered in S1 (identity no-op; clamp; col move reorders every row
+ delimiter together); DOM: grips exist with `data-*`; a synthesized drop calls the same move command
the drag-end calls and mutates `state.doc` (test the COMMAND, not the gesture). **WF (mandatory):**
live mouse drag reorders with a visible drop indicator and no WebView2 DnD glitch.

### S6 — Insert N×M table from scratch ✅  (`REQ-TBLED-1`)
**Shipped:** `insertTable(rows, cols)` (`table-commands.ts`) block-inserts `serialize(makeTable(r,c))` at
the caret — empty doc → just the table; on a blank line → flanked by blank lines; else a new block after
the caret's line — with the caret in the first header cell. Exposed via `EditorApi.insertTable`; the
hamburger menu's **Insert → Table…** opens `TableSizePicker.svelte`, an 8×8 hover-preview grid (click a
cell → insert that size, menu closes). 4 command tests (empty/text-line/blank-line/dimensions); the
picker → insert → render flow verified live. Original plan ⬇:
`makeTable(rows, cols)` (a `serialize` of an empty model — trivially pure; assert it round-trips via
`parseTable`). `insertTable(rows, cols)` command + EditorApi method inserts at the caret as one
transaction; a `.svelte` grid-picker with hover-preview calls it. **Tests:** PURE `makeTable(2,3)` ===
the canonical empty table (decide: a single space per cell for editability) + round-trip closure; DOM:
the inserted source renders as a `<table>`. **WF:** grid-picker hover-to-size + insertion feel.

### S7 — Toggle the header row on/off ⬜  (`REQ-TBLED-2`)
`toggleHeader(model)` pure. Default: ON→blank-header (clear header cell text, keep header+delimiter so
it stays valid GFM); the convert-to-paragraphs alt is gated behind the **open question** below. A
command + a widget toggle. **Tests:** PURE `toggleHeader` round-trip both directions stays parseable
GFM; DOM: the toggle mutates `state.doc` + re-renders header vs body. **WF:** toggle feel.

## New / changed files (anticipated)

- **New:** `src/lib/editor/table-model.ts` + `table-model.test.ts`; `src/lib/editor/table-commands.ts`
  (+ tests via the `editing.test.ts`/`table.dom.test.ts` pattern); a `.svelte` grid-picker (S6).
- **Changed:** `tables.ts` (consume `table-model`; widget grips + alignment controls + segment
  `data-seg-from`; pointer drag), `keymap.ts` (arrow-enter + cursor-context bindings), `setup.ts`
  (register `table-commands`), `theme.ts` (grip/handle/alignment-affordance/drop-indicator CSS),
  `Editor.svelte` (`insertTable`), `+page.svelte` (toolbar/picker glue), `requirements.md`,
  `llm-workflow-tests.md` (update WF-3; add drag/arrow/formatted-click WFs).

## New deps / settings
- **Deps:** none (the model is dependency-free; lezer/CM already present).
- **Settings:** none required for v1 (structural editing is command/affordance-driven). A future
  `markdown.tableAutoTidy` toggle is a no-migration additive follow-up if wanted.

## Risks
1. **Empty-cell column mis-indexing (highest, existing bug):** lezer drops empty cells (probe-confirmed
   `| a |  | c |`). Reconstruct columns from pipe geometry / the delimiter row, never from `TableCell`
   node count. S1 test (mid+trailing empty) is the explicit guard; the `tables.ts` refactor fixes the
   live render bug (current `table.dom.test.ts` is green only because it uses non-empty cells).
2. **Formatted-cell click mapping is only partly unit-testable:** the rendered↔source MATH is pure;
   the `caretPositionFromPoint` read is `/* v8 ignore */` live-only. Factor the math OUT of the layout
   call to keep the gate honest; live correctness is a WF gap (mirrors REQ-RENDER-10).
3. **Drag is entirely live-only:** unit/DOM tests cover the move COMMAND; the gesture wiring is WF-only.
   A drag bug can ship green in vitest (the M2 failure mode) — WF-NEW-D mandatory before release; budget
   WebView2 verification.
4. **Reveal + atomicRanges flicker:** placing the caret inside the block reveals raw pipes. Toolbar/drag
   ops must place the caret OUTSIDE `[from,to]` or the table flickers to source after every button click.
5. **Keybinding collisions:** `editingKeymap` (Prec.high) already binds `Enter`/`Backspace`/`Shift-Enter`/
   `Mod-b`/`Mod-i`/`Mod-Shift-m`/`Tab`; M4 added `Mod-.`. Cursor-context ops must pick non-colliding chords
   AND `return false` when not in a table, or they swallow keys globally — re-run `editing.test.ts` + the
   list/task WFs.
6. **Ragged/escaped corruption via tidy:** `\|` must survive and ragged rows must pad/widen (never drop);
   exhaustive S1 unit tests are mandatory (lines:100 gate).
7. **Caret preservation across a whole-table rewrite:** a `[from,to]` replace won't auto-map the caret;
   each op must deterministically compute the new caret (logical cell, not raw offset) in the same dispatch.
8. **Concurrent-edit / parse-lag:** compute the block range from the live `syntaxTree` at command time and
   the splice offsets from `state.doc` lines at dispatch time — never from stale node positions. The model
   is pure (can't see freshness); `tables.ts`/`table-commands.ts` own re-resolving the `Table` node.

## Open questions — RESOLVED (user, 2026-06-30)
1. **Toggle-header OFF (REQ-TBLED-2):** blank the header within GFM; truly-headerless tables open as
   text (lossless), rendering them is a flagged follow-up. (See the Decisions table.)
2. **Ragged-row overflow:** **widen** (confirmed).
3. **Cursor-context keybindings (REQ-TBLED-5):** the proposed chords are fine — **and add UI gizmos +
   a right-click menu in every mode** (see the "Edit affordances" decision; expands S3).
4. **New-cell placeholder (REQ-TBLED-1/-3):** **single space** (confirmed).
5. **Serialize style (REQ-TBLED-6):** **fitted, no alignment padding** (confirmed; see Decisions).
