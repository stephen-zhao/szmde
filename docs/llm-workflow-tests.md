# LLM-driven workflow tests (live WebView behavior)

_The behavioral test layer for things the Vitest/happy-dom suite **cannot** cover:
real layout, mouse clicks, caret placement, and visual appearance. These are the
"LLM-judged / deferred" tests promised in [testing-strategy.md](testing-strategy.md)
§T3 — now concrete. Every recurring click/caret bug in M2 (HR landing at the line
start, the alert off-by-one, ordered lists not nesting) passed the unit tests and
still shipped broken, because no test drove the live editor. This suite closes
that gap._

> **This suite MUST be run by an LLM agent with a live WebView.** There is no
> headless assertion runner here — a human or agent performs each workflow's
> actions in the real editor and checks the expected outcomes. happy-dom has no
> CSS box model, `getBoundingClientRect`, `caretPositionFromPoint`, or pointer
> dispatch, so none of this is expressible as a normal unit test.

> **Interim form.** This flat file is the usable v1. Promoting it to a first-class
> `e2e/` structure (one file per workflow + a maintained harness + a linkage-audit
> script) is tracked as **`REQ-TESTINFRA-1`** in [roadmap.md](roadmap.md) — not yet
> scheduled.

## When to run

- Before tagging a release.
- After any change to the editor interaction layer (`src/lib/editor/*` widgets,
  click handlers, keymap, theme) — at minimum the workflows whose `REQ` it touches.
- Whenever a visual/interaction bug is reported (add a new workflow for it first —
  red, then fix to green; this is TDD for live behavior).

## How to run (harness)

The Tauri dev `szmde.exe` is **not** controllable via computer-use (it's an
unregistered dev binary). Instead drive the **identical** UI from the Vite dev
server in a preview browser. See [reference: visual debugging](../docs/) and the
session memory `reference-szmde-visual-debugging`.

1. **Free port 1420** (kill any running `node`/`szmde`), then `preview_start` the
   `szmde-web` config (`.claude/launch.json`: `npm --prefix szmde run dev`, port
   1420). Vite uses a fixed strict port, so it won't share.
2. **Bootstrap the harness** — run this once per session via `preview_eval`. It
   relies on the DEV-only `window.__cmview` handle exposed by `Editor.svelte`:

   ```js
   (() => {
     const v = window.__cmview;
     const T = {
       setDoc(t){ v.dispatch({changes:{from:0,to:v.state.doc.length,insert:t},selection:{anchor:0}}); return v.state.doc.length; },
       caretTo(p){ v.dispatch({selection:{anchor:p}}); },
       doc(){ return v.state.doc.toString(); },
       text(){ return v.contentDOM.textContent; },
       count(s){ return v.contentDOM.querySelectorAll(s).length; },
       caret(){ const m=v.state.selection.main; return {head:m.head, char:v.state.doc.sliceString(m.head,m.head+1)}; },
       // realistic click at a fractional point inside the i-th `sel` element
       click(sel, fx=0.5, fy=0.5, i=0){
         const e=v.contentDOM.querySelectorAll(sel)[i]; if(!e) return {error:'no '+sel};
         const r=e.getBoundingClientRect(), x=r.left+r.width*fx, y=r.top+r.height*fy;
         const tgt=document.elementFromPoint(x,y)||e, o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0};
         tgt.dispatchEvent(new PointerEvent('pointerdown',o));
         tgt.dispatchEvent(new MouseEvent('mousedown',o));
         tgt.dispatchEvent(new MouseEvent('mouseup',o));
         tgt.dispatchEvent(new MouseEvent('click',o));
         return T.caret();
       },
       // press a keymap key (Enter/Tab/Backspace) — returns the resulting doc
       key(k, shift=false){ v.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:k,shiftKey:shift,bubbles:true,cancelable:true})); return v.state.doc.toString(); },
     };
     window.__T = T; return 'harness ready';
   })()
   ```

3. **Per workflow:** call `__T.setDoc(...)` for the setup, perform the steps with
   `__T.click/key/caretTo`, read outcomes with `__T.caret/doc/text/count` and
   `preview_screenshot`, and compare to **Expected**. Reload (`location.reload()`)
   between workflows that need a clean editor (CM themes/extensions don't fully
   hot-swap).
4. **Record** each workflow as PASS/FAIL with the observed value. A single FAIL
   fails the suite.

### Harness limitations (be honest about these)

- **Typing characters**: synthetic `keydown` drives the *keymap* (Enter/Tab/
  Backspace fire their commands), but it does **not** feed CodeMirror's
  `beforeinput`/IME path, so inserting literal text should be done via `setDoc`
  or a direct dispatch, not by simulating letter keys.
- **Real browser-default side effects** (e.g. Tab moving focus to the next
  element when *not* prevented) need a real keypress, which the eval harness can't
  produce. That specific aspect is covered by the unit test
  `editing.test.ts › "Tab is preventDefault'd"`; here we verify the functional
  result (spaces inserted / item nested).
- **Char-level click coords**: `fx` is a fraction of the element width; pick it to
  land on the target glyph. Allow ±1 character of tolerance unless the workflow
  says otherwise.

## Workflow catalog

Each workflow: **ID**, the `REQ-*` it exercises, the **bug** that motivated it (so
regressions are traceable to a real report), the **setup** doc, **steps**
(action → expected), and **notes**.

---

### WF-1 · Horizontal-rule click → caret at end · `REQ-HR-1`
**Bug:** "HR click lands at the beginning sometimes / non-deterministic."
**Setup:** `__T.setDoc("para\n\n---\n\npara2")`
**Steps:**
- Click the divider near its **top** edge: `__T.click(".cm-md-hr", 0.3, 0.05)` →
  Expected: `caret().head === 6` (the END of the `---` line, doc index 6), and the
  literal `---` is now revealed (`text()` contains `---`, `count(".cm-md-hr")===0`).
- Reset (`caretTo(0)`), click the divider **center**: `__T.click(".cm-md-hr")` →
  Expected: caret at the line end again (deterministic — never the start).

### WF-2 · GFM alert label click → exact character · `REQ-ALERT-2`
**Bug:** "alert click does nothing / lands at start or end / off by one."
**Setup:** `__T.setDoc("> [!WARNING]\n> body")` then `caretTo(20)` (caret on the
body line so the label renders).
**Steps:**
- Click roughly the 3rd char of the rendered name "Warning":
  `__T.click(".cm-alert-name", 0.35, 0.5)` → Expected: the source `[!WARNING]` is
  revealed (`count(".cm-alert-label")===0`) and the caret sits on the matching
  character of the source name (around `caret().char === "R"`/`"N"`, within ±1).
- Reset, click the **icon**: `__T.click(".cm-alert-icon")` → Expected: caret at the
  `[` of `[!WARNING]`.
**Notes:** the rendered name maps 1:1 onto the source name after `[!`.

### WF-3 · Table cell click → inline cell editor (table stays rendered) · `REQ-TBLED-7`
**Behavior (M5):** a rendered table is **atomic**; clicking a cell opens an inline
`<textarea>` over just that cell — the table does **not** un-render. Enter/Tab commit +
move (down/next), Esc cancels, blur commits. Raw pipe source shows in **Source mode** only.
**Setup:** `__T.setDoc("intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |")` (Formatted mode)
**Steps:**
- Click the body cell containing `2`: `__T.click("table.cm-md-table tbody td", 0.5, 0.5, 1)`
  → Expected: the table **stays rendered** (`count("table.cm-md-table") === 1`) and a cell
  editor textarea appears over that cell (`count("textarea.cm-md-cell-editor") === 1`), seeded
  with the cell's source (`2`).
- Type `20`, press Enter → Expected: the editor commits and moves down; `doc()` now has `20`
  in that cell and the table re-renders as valid GFM. A typed `|` / newline is sanitized so the
  table can't break.
- Reset; put the caret before the table and press ↓/→ → Expected: the caret **skips past** the
  whole rendered table (atomic), landing after it — it does not enter cell-by-cell.
**Notes:** this supersedes the old "click reveals raw pipes / caret lands at the clicked char /
arrows enter the table" design. REQ-TABLE-2 (render + Source-mode literal pipes) is covered
structurally by `table.dom.test.ts`, not here.

### WF-4 · Ordered-list nesting via Tab → depth styling · `REQ-NEST-1`
**Bug:** "ordered nesting doesn't work — everything stays decimal, numbering
continues across levels instead of resetting."
**Setup:** `__T.setDoc("1. first\n2. second")`, then `caretTo(<end of line 2>)`.
**Steps:**
- `__T.key("Enter")` then `__T.key("Tab")` → Expected `doc()` indents the new item
  by 3 spaces (`"…\n   3. "` — the marker width, so it actually nests).
- Load `__T.setDoc("1. a\n2. b\n   1. x\n   2. y")` →
  Expected: the rendered ordinals are `1. 2. a. b.` (level-1 decimal, level-2
  lower-alpha), confirmed via `preview_screenshot` or the `.cm-md-list-number`
  text contents. Numbering **restarts** in the nested list.
- Load `"1. a\n2. b\n      1. p\n      2. q"` (level 3) → Expected level-3 shows
  lower-roman `i. ii.`.

### WF-5 · Task Enter continuation → new task item · `REQ-LIST-3`
**Bug:** "after a multi-line task, Enter makes a raw bullet, not a task item."
**Setup:** `__T.setDoc("- [ ] one")`, `caretTo(9)`, `__T.key("Enter", true)`
(Shift-Enter soft break), type a continuation via `setDoc` to `"- [ ] one\n      two"`,
`caretTo(19)`.
**Steps:**
- `__T.key("Enter")` → Expected `doc()` ends with a new `\n- [ ] ` task item (not
  `\n- `).

### WF-6 · Task checkbox click toggles on disk · `REQ-TASK-2`
**Setup:** `__T.setDoc("- [ ] todo")`
**Steps:**
- `__T.click("input.cm-md-task")` → Expected `doc() === "- [x] todo"`; click again
  → `"- [ ] todo"`.

### WF-7 · Tab is a soft tab, not focus-traversal · `REQ-LIST-4`
**Bug:** "Tab moved focus to the next element like a browser."
**Setup:** `__T.setDoc("hi")`, `caretTo(2)`
**Steps:**
- `__T.key("Tab")` → Expected `doc() === "hi  "` (2 spaces inserted).
- `__T.setDoc("- [ ] ")`, `caretTo(6)`, `__T.key("Tab")` → Expected `"  - [ ] "`
  (empty task nests).
**Notes:** the browser-default focus-traversal aspect is covered by the unit
preventDefault test; this verifies the editor command result.

### WF-8 · Syntax mode keeps `[ ]` full-size · `REQ-TASK-1`
**Bug:** "task checkboxes render tiny-grey in Syntax mode — they're real content."
**Setup:** `__T.setDoc("- [ ] todo")`, switch render mode to **Syntax** (hamburger
menu → Syntax, or `Ctrl/Cmd+Shift+M` twice).
**Steps:**
- Expected: the line shows literal `[ ]` at **normal text size** (no
  `.cm-md-mark-syntax` wrapping the `[`/`]` — `preview_inspect` the font-size of
  the bracket vs a paragraph char; they match). The leading `-` may still be a
  grey token.

### WF-9 · Task multi-line hang-indent alignment · `REQ-TASK-1`
**Bug:** "multi-line task continuation lines don't align under the content."
**Setup:** `__T.setDoc("- [ ] first line\n      second line")` (Formatted mode).
**Steps:**
- Screenshot / measure: the left edge of `second line` aligns with the left edge of
  `first line`'s text (i.e. past the checkbox + space), not at the margin. Confirm
  via the `.cm-md-hang-indent` clone width tracking the checkbox (must hold at any
  font size — change `--editor-font-size` and re-check).

### WF-10 · Image renders inline · `REQ-IMG-1`
**Setup:** `__T.setDoc("intro\n\n![cat](https://placekitten.com/80/80)")`
**Steps:**
- Expected: `count("img.cm-md-image") === 1`; with the caret off the image line it
  shows the image; clicking into the line reveals `![cat](…)`.

### WF-11 · Scrollbar doesn't shift the column · `REQ-UI-1`
**Bug (M1):** "scrollbar appearing shifts the centered column horizontally."
**Setup:** `__T.setDoc("x\n".repeat(2))` (no scrollbar), record the `.cm-content`
left offset; then `setDoc("x\n".repeat(400))` (forces a vertical scrollbar).
**Steps:**
- Expected: the `.cm-content` `getBoundingClientRect().left` is **unchanged**
  between the two (scrollbar-gutter reserved).

### WF-12 · Status-bar chips drive their actions · `REQ-UI-2`
**Bug class:** chip behavior is `.svelte` glue, untested by unit tests.
**Steps:** click the render-mode chip → mode cycles (chip label changes
Formatted→Source→Syntax); click the EOL chip → toggles LF⇄CRLF; click the indent
chip → menu opens, picking "Spaces: 4" updates the chip. After a change, reload —
the choice **persists** (settings, `REQ-SET-1`).

### WF-13 · "Modern, sleek, dark" look · `REQ-LOOK-1` _(LLM-judged)_
**Setup:** a representative doc (heading, paragraph, list, code block, table, alert).
**Steps:** `preview_screenshot` and judge against the rubric: dark background by
default, a single accent color, generous whitespace, a centered readable column,
no visual clutter/chrome beyond the hamburger + corner chips. Record a pass/fail
+ one-line rationale.

### WF-14 · No perceptible typing lag · `REQ-PERF-1` _(LLM-judged / measured)_
**Setup:** a ~5,000-line doc.
**Steps:** dispatch a burst of edits and sample `performance.now()` around the
view update; expect keystroke-to-update well under one frame (~16 ms). Coarse, but
flags gross regressions.

### WF-15 · Save-conflict modal → overwrite / save-copy / reload · `REQ-SAVE-1`
**Why:** the detection + rev logic is unit/cargo-tested, but the modal flow is
`.svelte` glue + a real on-disk file changing under the editor — only observable
live. **Needs the Tauri dev app** (real fs), not the Vite-only preview.
**Setup:** open a saved file; in another program, edit + save that same file so its
on-disk revision changes; make an edit in szmde so it's dirty; press Ctrl+S.
**Steps:**
- Expected: the "File changed on disk" modal appears (the write was NOT silently
  applied over their change).
- **Overwrite** → the file now holds szmde's version; a subsequent Ctrl+S is clean
  (no modal — the baseline rev was refreshed).
- Re-trigger; **Save a copy** → a sibling `…(copy).md` is written with szmde's
  version, the original is untouched, and the editor is now editing the copy.
- Re-trigger; **Reload theirs** → the editor content becomes the on-disk version,
  the dirty marker clears, and a following Ctrl+S is clean.
- **Cancel** / **Esc** → nothing is written, the document stays dirty.
**Notes:** Save As to a brand-new path never conflicts (unconditional write).

### WF-17 · Google Drive open/save round-trip · `REQ-CLOUD-1`
**Why:** the request/response/error mapping is unit-tested with a mocked fetch,
but the live OAuth handshake, real network, and Drive's actual ETag/If-Match
semantics can only be exercised end-to-end. **Needs the Tauri dev app + a Google
OAuth client ([m3-cloud-setup.md](m3-cloud-setup.md)).**
**Status:** ✅ **live** — the open→edit→save round-trip was user-verified (2026-07, then under the
full scope; the scope has since narrowed to `drive.file` + the Picker — see WF-28, which now owns
the open-a-file path).
**Setup:** open a `.md` via the Picker (WF-28) or be already connected with the file granted. Uses
the **non-sensitive `drive.file` scope** (REQ-CLOUD-3) — per-file access granted by the pick; **no
unverified-app warning** (see [m3-cloud-setup.md](m3-cloud-setup.md)).
**Steps:**
- Open the Drive file → Expected: its content loads; editing + Ctrl+S writes back
  (verify the change in Drive's web UI).
- Change the file in Drive's web UI, then save again in szmde → Expected: the
  conflict modal (WF-15) appears (If-Match precondition failed → conflict).
- Disconnect network mid-save → Expected: the write is queued offline (REQ-SAVE-3,
  M3 S4) and flushes on reconnect; no data loss.
- Let the access token expire (or revoke it) → Expected: a transparent refresh, or
  a re-auth prompt if the refresh token is gone (no silent failure).

### WF-18 · OneDrive open/save round-trip · `REQ-CLOUD-2` — ⛔ BLOCKED (not yet runnable)
**Blocked:** OneDrive is **backend-only** (`onedrive.ts` + unit tests). There is no
`onedrive-connect` orchestration and no "Connect OneDrive" UI entry yet, so there is nothing to
drive live. Un-block when the OneDrive live wiring lands (mirror `gdrive-connect.ts`).
**Why (once unblocked):** same rationale as WF-17, against Microsoft Graph. **Needs the Tauri dev
app + an Azure app registration ([m3-cloud-setup.md](m3-cloud-setup.md)).**
**Setup:** connect a Microsoft account (hamburger → Storage → Connect OneDrive…);
have a `.md` file in that OneDrive.
**Steps:** mirror WF-17 — open loads content; Ctrl+S writes back (verify in
OneDrive web); an out-of-band change → conflict modal on next save; offline →
queued + flush on reconnect; token expiry → refresh / re-auth.

### WF-19 · Word-count chip updates live, off by default · `REQ-COUNT-1`
**Why:** the count math is unit-tested (`count.test.ts`); the chip visibility, live
update, and no-lag are `.svelte`/layout — live-only.
**Setup:** default settings (chip hidden); then set `appearance.showWordCount=true`.
**Steps:**
- Default: no word-count chip in the status bar. With the setting on, a read-only
  `N words` chip appears (and the char count in its tooltip).
- Type/delete → the count updates within a keystroke; holding a key in a large doc
  shows no typing lag (the recompute is gated on docChanged).
- Cycle render modes (Formatted/Source/Syntax) → the number is unchanged (counts
  the raw buffer, not the rendered view).

### WF-20 · Find & replace panel · `REQ-FR-1` / `REQ-FR-2` / `REQ-FR-3`
**Why:** the search/replace commands + the capture-group transform are dom-tested;
the real keystroke routing, panel focus/theme, input legibility, and match-highlight
visibility are live-only.
**Setup:** a doc with repeated words + a heading + a line like `2026-06-28`.
**Steps:** `Ctrl+F` opens the themed top panel (matches the dark UI); **the find/
replace input boxes are comfortably large and ALL panel text is the same, legible
size** (REQ-FR-3), and they scale up when the editor is zoomed (Ctrl+scroll); type a
query → matches highlight; Enter / next/prev cycles; toggle regex `.*` and search
`c.t`; Replace / Replace-all mutate the text; **with regex on, replacing
`(\d{4})-(\d{2})-(\d{2})` with `\3/\2/\1` reorders to `28/06/2026` — the backslash
capture-group form works, as does `$1`** (REQ-FR-2); a match inside a hidden
Clean-mode marker reveals it; pressing `Ctrl+Shift+M` while the find input is
focused cycles the render mode WITHOUT stealing focus from the find box; `Escape`
closes and returns focus to the editor; no typing lag.

### WF-21 · Emoji shortcodes render · `REQ-EMOJI-1`
**Why:** decoration structure is dom-tested; the actual glyph rendering/baseline
alignment + font fallback are live-only.
**Setup:** `:rocket: ships :heart: today` in Clean mode.
**Steps:** the shortcodes show as glyphs (🚀, ❤️) with the literal hidden; clicking
into a shortcode reveals `:rocket:` for editing; `:notarealemoji:` stays literal;
a shortcode in `` `:code:` `` / a fenced block stays literal; in Source/Syntax the
literal `:rocket:` is shown; setting `markdown.emoji=false` disables rendering.

### WF-22 · Foldable heading sections · `REQ-FOLD-1` / `REQ-FOLD-2`
**Why:** the fold mechanics + button attrs are dom-tested; the chevron hit-area,
prominence, click-vs-caret disambiguation, and no-column-jump are live-only.
**Setup:** a doc with `#`/`##`/`######` headings and bodies.
**Steps:** a ▾ chevron shows on each heading line (not body lines) **rendered as a
prominent, clearly-clickable BUTTON chip (border + raised fill, hover highlight) —
not a faint tiny glyph** (REQ-FOLD-2), the SAME comfortable size on an h1 as an h6
(it doesn't balloon with heading size) and it doesn't clip the left gutter or shift
the heading text; clicking it folds the section to a `⋯` placeholder with the
heading still visible; clicking the chevron (now ▸) or the `⋯` unfolds; `Mod-.`
toggles at the cursor; `Ctrl+Shift+[` / `]` fold/unfold; the centered column doesn't
shift; the button looks/works the same in all three render modes; a plain click on
heading text still places the caret.

### WF-23 · Scroll-zoom text size + page width · `REQ-ZOOM-1` / `REQ-ZOOM-2` / `REQ-ZOOM-3`
**Why:** the step math + wheel routing + window-cap clamp are unit-tested; the real
wheel gesture, live re-layout, window-resize tracking, and persistence are live-only.
**Steps:** Ctrl/Cmd+scroll over the canvas grows/shrinks all text (headings, code,
markers scale together) while the column width stays constant (text wraps sooner);
Shift+scroll widens/narrows the reading column **continuously (±40px/step), and can
grow it all the way out to the window width — no longer capped at a small "wide"
preset** (REQ-ZOOM-3); **shrinking the OS window below the chosen width makes the
column cling to the window width, and widening the window grows it back out to the
chosen width**; on a wider window the gesture can reach a larger max; a plain scroll
still scrolls normally; both values persist across an app reload; Ctrl+wheel doesn't
trigger the WebView's native page-zoom.

### WF-24 · Syntax-mode marker gutter + 3-column layout · `REQ-RENDER-9` / `REQ-RENDER-10` / `REQ-RENDER-12` / `REQ-ZOOM-4`
**Why:** decoration structure + in-flow proof (no widget-buffer, zero atomic) are
dom-tested; the actual gutter hang, baseline, flush text, the caret landing in the
gutter, the 3 columns, and no-clipping need real layout — and the native-caret
position is engine-dependent, so this is also the **WebView2** confirmation that the
text-indent fix lands the caret in the gutter (where some Chromium builds masked the
bug).
**Setup:** Syntax mode, a doc with `#`..`######` headings (each with a body so they
fold) + a `>` quote + `> >` nested quote + paragraphs.
**Steps:**
- **Columns (REQ-RENDER-12):** three lanes left-to-right — fold-chevron, marker
  gutter, content. The chevron sits in its OWN column at the SAME x for every
  heading level (`#` through `######`); the small-grey marker prefix hangs in the
  gutter; heading/quote text is flush with paragraph text. The `######` markers must
  NOT touch the chevron (there's a clear gap) — the old deep-heading/chevron overlap
  is gone. The marker sits on the SAME baseline as the heading text (REQ-RENDER-10).
  The arrow glyph (▾/▸) is CENTRED inside the chevron button at every depth — the
  heading line's inherited `text-indent` is reset on the chevron so the glyph isn't
  dragged out of the button (worse for deeper headings).
- **Caret in the gutter (the core fix, REQ-RENDER-9):** put the caret at the END of
  the line BEFORE a heading and press →; the caret lands in the GUTTER, just left of
  the first `#` (NOT at the margin, NOT past the hashes). This is the WebView2 bug —
  confirm it's now correct there. Keep pressing → : it steps through each `#`, the
  space, then the heading text — one position at a time, no jumps. Move the caret
  on/off the heading repeatedly and scroll: the `#` stays put and the caret tracks
  it every time. Same for a `>` quote.
- **Page width (REQ-ZOOM-4):** Shift+scroll the page width out to the window max —
  the chevron + markers stay fully visible (never clip off the left edge), no
  horizontal scrollbar appears.
- It all holds when `--editor-font-size` changes (Ctrl+scroll) and with a custom
  font family — the gutter re-measures so text stays flush.
_Residual cosmetic limit: an extreme combined prefix (`> ###### `, or 4+ nested
quotes) can reach a few px into the chevron column._

### WF-25 · Formatted-mode reveal renders Syntax-style markers · `REQ-RENDER-11`
**Why:** the decoration choice is dom-tested; the live look/feel of a revealed
marker (and that the text doesn't jump) needs real layout.
**Setup:** Formatted (Clean) mode; a doc with `## Heading`, `> quote`, and
`a **bold** word`.
**Steps:** with the caret OFF the heading line the `##` is hidden; moving the caret
onto it reveals the `##` as a **small-grey marker hung in the left gutter (exactly
like Syntax mode), NOT a full-size raw `## ` literal**, and the heading text does
**not** shift right as it appears; same for `>` on a quote line; clicking inside
`**bold**` reveals small-grey `**` tokens (not the bold-styled Source markers); the
revealed markers are editable (arrow/click into them) and re-hide when the caret
leaves.

### WF-26 · Render-mode toggle survives focus drift · `REQ-RENDER-7`
**Why:** the cycle command is unit-tested; the focus/keystroke routing that made it
"stick" is live-only.
**Setup:** any doc; a blockquote present.
**Steps:** click the render-mode status chip a few times → it cycles
Formatted→Source→Syntax and focus returns to the editor; now click the chip once
(focus on the button) and press `Ctrl+Shift+M` → it **still cycles** (the app-level
fallback handles it even though the editor lost focus); pressing `Ctrl+Shift+M` with
the caret inside a blockquote in Formatted mode keeps toggling normally (no stuck
state).

### WF-16 · Autosave fires after the interval · `REQ-SAVE-2`
**Why:** the debounce/coalesce logic is unit-tested, but the editor→scheduler→
save wiring and the settings seed are `.svelte` glue. **Needs the Tauri dev app.**
**Setup:** in `user.json` set `editor.autosave=true` and a short
`editor.autosaveIntervalMs` (e.g. 1000); launch and open a saved file.
**Steps:**
- Type an edit; the status dirty dot (`•`) appears. Wait ~1 s without typing →
  Expected: the file is written to disk (verify externally) and the dirty dot
  clears, with no Save dialog.
- Type a fast burst → Expected: a single save fires ~1 s after the LAST edit, not
  one per keystroke (coalesced).
- A brand-new untitled buffer is **not** autosaved (no Save As dialog pops); it
  only autosaves after a first manual Save gives it a path.

### WF-27 · Toggle table header on/off · `REQ-TBLED-2`
**Behavior (M5 S7):** a **lossless** header toggle. With a populated header, "off" demotes the
header into the first body row and blanks the header (kept valid GFM — the header text is NOT
lost); with a blank header, "on" promotes the first body row back up. Reachable via `Mod-Alt-h`
and the right-click **Toggle header row** item; the rendered table updates in place.
**Setup:** `__T.setDoc("| a | b |\n| - | - |\n| 1 | 2 |")`, caret in a cell (Formatted mode).
**Steps:**
- Press `Ctrl/Cmd+Alt+H` (or right-click a cell → **Toggle header row**) → Expected: the table
  stays rendered (`count("table.cm-md-table") === 1`); the header row is now empty and the old
  header shows as the first body row (`doc()` starts `"|  |  |\n| --- | --- |\n| a | b |…"`).
- Toggle again → Expected: `doc()` returns to `"| a | b |\n| --- | --- |\n| 1 | 2 |"` (off→on
  round-trips; the header is restored, nothing lost).
- Put the caret outside any table and press the chord → Expected: no change (the command returns
  false and passes the key through).

### WF-28 · Google Picker open (least-privilege) · `REQ-CLOUD-3`
**Why:** the URL build, redirect parsing, Host allowlist, and token exchange are unit-tested; the
real consent + Picker UI + per-file grant semantics only exist live. **Needs the Tauri dev app + the
Cloud Console setup ([m3-cloud-setup.md](m3-cloud-setup.md): `drive.file` scope + Picker API enabled).**
**Setup:** a pre-existing `.md` in your Drive that szmde has never touched; szmde disconnected.
**Steps:**
- **hamburger → Storage → Open from Google Drive…** → Expected: the system browser opens ONE tab
  with consent **and** the Google Picker; the consent screen shows **NO unverified-app /
  restricted-scope warning** (the whole point of `drive.file`).
- Pick the `.md` → Expected: the browser tab says signed in / close; szmde loads the file's content
  (no paste-an-ID modal — it no longer exists).
- Edit + Ctrl+S → Expected: the change lands in Drive (verify in Drive web) — the per-file grant
  covers writes.
- Close and relaunch szmde, **Open from Google Drive…** again and pick the SAME file → Expected: it
  opens (re-pick re-grants); also verify a **previously-granted** file still reads without a re-pick
  while tokens live (open risk #4 — grant persistence across sessions).
- Cancel the consent (close the tab / hit Cancel) → Expected: szmde shows a clean "declined" error,
  no hang (the loopback surfaces Google's `error=` redirect).
- Sanity: check `myaccount.google.com/permissions` shows szmde with per-file (not full-Drive) access.

### WF-29 · Responsive shell at phone width · `REQ-MOBILE-2` _(M6 S2 — browser-width; extends on-device in S3)_
**Why:** the responsive layout is CSS (media queries + `env()` insets) that happy-dom can't evaluate.
S2 is the layout half of REQ-MOBILE-2 (the soft-keyboard/IME half is WF-30, S3, real device only).
**Setup:** the szmde dev app / Vite server; a doc with a longish filename + a table.
**Steps (a narrow browser ≤600px stands in for the phone for the layout checks):**
- At **375px** width: the hamburger button is **≥44×44**; opening it shows a menu with **≥44px** rows
  that **scrolls** (doesn't overflow the screen) and can't exceed the viewport width.
- The bottom status chips **wrap** instead of running off-screen; a long filename **truncates** with an
  ellipsis; each tappable chip is a comfortable touch target (≥34px tall); the editor column is
  effectively full-width (it already clings to the window width, REQ-ZOOM-3).
- Resize to **desktop (≥1280px)**: the layout is **identical to before M6** — hamburger 36×36, compact
  bottom-right chips, no wrap (the media query and `env()` maxes resolve to the original values).
- On a **real device** (or with `viewport-fit=cover` emulated): the hamburger clears a notch/status bar
  and the status bar clears the home indicator (safe-area insets); no horizontal page scroll.

---

## Requirement coverage

| REQ | Unit/integration (Vitest/cargo) | LLM workflow (this doc) |
|-----|---------------------------------|--------------------------|
| REQ-HR-1 | structure (`hr.dom.test.ts`) | WF-1 (click→end) |
| REQ-ALERT-2 | structure (`alerts.dom.test.ts`) | WF-2 (click→char) |
| REQ-TABLE-2 | structure (`table.dom.test.ts`) | — (render + Source-mode literal pipes; structural only) |
| REQ-TBLED-7 | structure (`table-cell-editor.dom.test.ts`, `table.dom.test.ts`) | WF-3 (inline cell editor; table stays rendered, atomic-skip) |
| REQ-TBLED-2 | model + structure (`table-model.test.ts`, `table.dom.test.ts`) | WF-27 (header toggle on/off) |
| REQ-NEST-1 | structure (`nested.dom.test.ts`) | WF-4 (Tab nest + styling) |
| REQ-LIST-3 | doc model (`editing.test.ts`) | WF-5 (task Enter) |
| REQ-TASK-2 | doc model (`tasklist.dom.test.ts`) | WF-6 (toggle) |
| REQ-LIST-4 | command + preventDefault (`editing.test.ts`) | WF-7 (soft tab) |
| REQ-TASK-1 | structure (`tasklist.dom.test.ts`) | WF-8 (syntax size), WF-9 (alignment) |
| REQ-IMG-1 | structure (`image.dom.test.ts`) | WF-10 (renders) |
| REQ-UI-1 | DOM (`theme.dom.test.ts`) | WF-11 (no shift) |
| REQ-UI-2 | — (gap) | WF-12 (chips) |
| REQ-LOOK-1 | — (gap) | WF-13 (look) |
| REQ-PERF-1 | — (gap) | WF-14 (lag) |
| REQ-SAVE-1 | logic (`storage/local.test.ts`, `storage/conflict.test.ts`, cargo) | WF-15 (conflict modal) |
| REQ-SAVE-2 | logic (`storage/autosave.test.ts`) | WF-16 (autosave fires) |
| REQ-CLOUD-1 | logic (`storage/gdrive.test.ts`, `cloud-http.test.ts`, `oauth.test.ts`) | WF-17 (Drive round-trip — ✅ live, verified) |
| REQ-CLOUD-2 | logic (`storage/onedrive.test.ts`, `cloud-http.test.ts`, `oauth.test.ts`) | WF-18 (OneDrive round-trip — ⛔ blocked, backend-only) |
| REQ-CLOUD-3 | logic (`storage/gdrive-connect.test.ts`, Rust `parse_redirect`/`parse_error`/`host_allowed`) | WF-28 (Picker open, no-warning consent, grant persistence) |
| REQ-COUNT-1 | logic (`editor/count.test.ts`) | WF-19 (chip live/off-by-default) |
| REQ-FR-1 | structure (`editor/search.dom.test.ts`) | WF-20 (find panel) |
| REQ-FR-2 | unit+structure (`editor/replace-groups.test.ts`, `search-replace.dom.test.ts`) | WF-20 (`\1` capture group) |
| REQ-FR-3 | — (visual gap) | WF-20 (input legibility/size) |
| REQ-EMOJI-1 | map+structure (`editor/emoji.test.ts`, `emoji.dom.test.ts`) | WF-21 (glyph render) |
| REQ-FOLD-1 | structure (`editor/fold.dom.test.ts`) | WF-22 (fold affordance) |
| REQ-FOLD-2 | structure (`editor/fold.dom.test.ts`) | WF-22 (button prominence) |
| REQ-ZOOM-1/2 | logic (`editor/zoom.test.ts`) | WF-23 (scroll zoom/width) |
| REQ-ZOOM-3 | logic (`editor/zoom.test.ts`) | WF-23 (window-relative width) |
| REQ-ZOOM-4 | — (visual gap) | WF-24 (columns stay visible at max width) |
| REQ-RENDER-9 | structure (`editor/markers.dom.test.ts`) | WF-24 (gutter hang, in-flow, caret-in-gutter) |
| REQ-RENDER-10 | — (visual gap) | WF-24 (baseline alignment) |
| REQ-RENDER-12 | structure (`markers.dom.test.ts`, `fold.dom.test.ts`) | WF-24 (3-column layout, no overlap) |
| REQ-RENDER-11 | structure (`editor/markers.dom.test.ts`) | WF-25 (reveal = syntax style) |
| REQ-RENDER-7 | unit (`render-mode.test.ts`, `render-mode-cycle.test.ts`) | WF-26 (toggle survives focus drift) |

The three former [requirements.md](requirements.md) gaps with no automated test
(REQ-UI-2, REQ-LOOK-1, REQ-PERF-1) now have a linked **LLM** test here. The rest
gain a live-behavior layer on top of their structural unit tests.
