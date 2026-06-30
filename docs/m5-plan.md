# M5 — Rich table editing (implementation plan)

_Implementation plan for milestone **M5** (see [roadmap.md](roadmap.md) "M5" for the
requirement slotting and [SPEC.md](../SPEC.md) §7.4 / §5.1 for the behavior). SPEC.md is the
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
| **Tidy padding width** | raw bytes vs display | **Code-point count** (`[...cell].length`), CJK/emoji as documented approximation (mirrors `count.ts`'s CJK note). Padding is cosmetic + reversible; tidy NEVER changes cell content. |
| **Escaped pipe `\|`** | unescape vs preserve | **Preserved literally** inside the cell (lezer `esc` flag); never re-split, never unescaped. Padding counts the source chars. |
| **Ragged-row overflow** | clamp vs widen vs keep | A short body row is **padded** to colCount; a long body row **widens the whole table** (adds header+delimiter cols) rather than dropping cells — silently clamping would corrupt the file. |
| **Drag mechanism** | HTML5 `draggable` vs pointer | **Pointer events + `setPointerCapture` on explicit grips.** HTML5 DnD fights CM's contenteditable host + `atomicRanges` + WebView2 native DnD. Matches every existing widget handler. |
| **Toggle-header OFF (REQ-TBLED-2)** | no portable GFM headerless table | **Default: clear the header row's cell text** (keep header+delimiter so it stays a valid GFM table; "off" = blank header). Converting to plain paragraphs is the overridable alt. **Open question — confirm with user.** |
| **Arrow "enter table" (REQ-TBLED-7)** | land in source vs rendered-cell nav | **Land in the SOURCE** at the column under the caret's x (trips the existing reveal). Rendered-cell-to-cell navigation while the table stays rendered is **out of scope v1**. |
| **Post-edit caret** | inside vs outside block | Cursor-context ops (-5) + click (-7) leave the caret **inside** (reveal is desired). Drag (-4) + toolbar ops (-1/-2/-3/-6) place the caret **outside** `[from,to]` so the rendered table updates in place (no flicker-to-pipes). |
| **Insert affordance (REQ-TBLED-1)** | picker vs command | Ship a **command first** (`insertTable`), the grid-picker `.svelte` as the affordance over it. |

## Staged build sequence

> Each slice: **failing test(s) first** (TDD, T4), then implementation, `npm run test` +
> `npm run check` green, update [requirements.md](requirements.md) with the `REQ-TBLED-*` rows and
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

### S3 — Insert/delete row & col + cursor-context shortcuts ⬜  (`REQ-TBLED-3`, `REQ-TBLED-5`)
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

### S4 — Per-column alignment UI + tidy command ⬜  (`REQ-TBLED-6` UI half)
`setColAlign`/`tidy` pure (S1). Alignment control in the column handle cycling `:--`/`:-:`/`--:`
(targeted single-region `ChangeSpec` on the one delimiter cell). An explicit Tidy command (whole-table
replace). **Tests:** PURE re-asserted (delimiter cell correct, tidy idempotent); DOM: clicking the
alignment affordance mutates `state.doc`'s delimiter row + the rendered `th/td` `style.textAlign`
updates (reuses the proven `parseAligns`→`textAlign` path). **WF:** alignment toggle + monospace tidy
look right (column widths are layout — happy-dom can't judge).

### S5 — Drag to reorder rows/columns ⬜  (`REQ-TBLED-4`)
`moveRow`/`moveCol` pure (S1). Pointer-based grips in `TableWidget.toDOM`: `pointerdown`
(preventDefault, `setPointerCapture`, record source index) → `pointermove` (hit-test other grips →
drop index + indicator) → `pointerup` (dispatch the move; caret OUTSIDE the block so the table stays
rendered). **Tests:** PURE move ops covered in S1 (identity no-op; clamp; col move reorders every row
+ delimiter together); DOM: grips exist with `data-*`; a synthesized drop calls the same move command
the drag-end calls and mutates `state.doc` (test the COMMAND, not the gesture). **WF (mandatory):**
live mouse drag reorders with a visible drop indicator and no WebView2 DnD glitch.

### S6 — Insert N×M table from scratch ⬜  (`REQ-TBLED-1`)
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

## Open questions (confirm before building)
1. **Toggle-header OFF semantics (REQ-TBLED-2):** GFM has no headerless table. Default chosen =
   blank the header cells (stays valid GFM). Confirm vs the alt (convert the table to plain paragraphs).
2. **Ragged-row overflow:** default = widen the whole table (add header+delimiter cols) when a body row
   has more cells than the header. Confirm vs keeping overflow flagged or a hard clamp.
3. **Cursor-context keybindings:** proposed `Alt-Shift-Arrows` (move) + `Mod-Enter`/`Mod-Shift-Enter`
   (insert row) + a scheme for insert/delete col. Confirm the chords (and whether macOS `Option`-Arrow
   word-nav collisions matter).
4. **Empty-cell placeholder on insert (REQ-TBLED-1/-3):** a single space per new cell (editable) vs truly
   empty `||`. Default = single space.
