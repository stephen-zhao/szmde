import { EditorSelection, Prec } from "@codemirror/state";
import type { Extension, StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentLess, indentMore, insertNewlineAndIndent } from "@codemirror/commands";
import { getIndentUnit, indentString, syntaxTree } from "@codemirror/language";
import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { cycleRenderMode } from "./render-mode";
import {
  enterTableDown,
  enterTableUp,
  insertRowBelow,
  insertRowAbove,
  moveRowDown,
  moveRowUp,
  moveColLeft,
  moveColRight,
  tidyTable,
} from "./table-commands";

/** True if `pos` is inside inline or fenced code (where B/I should be inert). */
function inCode(state: Parameters<StateCommand>[0]["state"], pos: number): boolean {
  const tree = syntaxTree(state);
  for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "InlineCode" || n.name === "FencedCode") return true;
  }
  return false;
}

/**
 * Toggle a wrapping inline marker (`**` for bold, `*` for italic) around each
 * selection — wrap if not already inside the construct, unwrap if it is. An
 * empty selection expands to the word at the cursor. Inert inside code.
 */
function toggleWrap(marker: string, construct: string): StateCommand {
  const mlen = marker.length;
  return ({ state, dispatch }) => {
    let didChange = false;
    const spec = state.changeByRange((range) => {
      let { from, to } = range;
      if (inCode(state, from)) return { range };
      if (from === to) {
        const w = state.wordAt(from);
        if (w) {
          from = w.from;
          to = w.to;
        } else {
          return { range }; // nothing to wrap
        }
      }
      const tree = syntaxTree(state);
      let node: ReturnType<typeof tree.resolveInner> | null = null;
      for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(from, 1); n; n = n.parent) {
        if (n.name === construct) {
          node = n;
          break;
        }
      }
      didChange = true;
      if (node && node.from <= from && node.to >= to) {
        // Unwrap: drop the opening and closing markers (the selection shifts
        // left by the opening marker's length).
        return {
          changes: [
            { from: node.from, to: node.from + mlen },
            { from: node.to - mlen, to: node.to },
          ],
          range: EditorSelection.range(from - mlen, to - mlen),
        };
      }
      // Wrap: insert the marker before and after (post-change selection is +mlen).
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + mlen, to + mlen),
      };
    });
    if (!didChange) return false;
    dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBold = toggleWrap("**", "StrongEmphasis");
export const toggleItalic = toggleWrap("*", "Emphasis");

/** An empty list item: leading indent (group 1) + marker + space, optionally a
 *  task checkbox `[ ]`/`[x]` with no text after it (an empty task). Shared by the
 *  Tab (nest) and Enter (outdent/exit) handlers, so empty tasks behave like
 *  empty bullets. */
const EMPTY_LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?$/;

/**
 * If the caret sits on a CONTINUATION line of a list item — a soft-broken line
 * (made with Shift-Enter) that the parser folds into the item but which carries
 * no marker of its own — return the marker text for a new sibling item:
 * indentation + bullet/incremented-number + a trailing space. Otherwise null.
 *
 * `insertNewlineContinueMarkup` only re-emits a marker when the caret is on the
 * item's own marker line; on a continuation line it inserts a bare newline (and
 * for an ordered item whose continuation text is shorter than the marker width
 * it mis-detects an "empty line" and DELETES that text). In szmde, Shift-Enter
 * is the soft break and Enter always means "new item", so we handle this here.
 */
function listContinuationMarker(
  state: Parameters<StateCommand>[0]["state"],
  pos: number,
): string | null {
  const tree = syntaxTree(state);
  let item: ReturnType<typeof tree.resolveInner> | null = null;
  for (
    let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, -1);
    n;
    n = n.parent
  ) {
    if (n.name === "ListItem") {
      item = n;
      break;
    }
  }
  if (!item) return null;
  const markerLine = state.doc.lineAt(item.from);
  // On the item's own marker line → let insertNewlineContinueMarkup handle it.
  if (markerLine.number >= state.doc.lineAt(pos).number) return null;
  const mark = item.getChild("ListMark");
  if (!mark) return null;
  const indent = markerLine.text.slice(0, item.from - markerLine.from);
  const markText = state.doc.sliceString(mark.from, mark.to);
  // A task item continues as a new unchecked task (`- [ ] `), not a raw bullet.
  const task = item.getChild("Task") ? "[ ] " : "";
  if (item.parent?.name === "OrderedList") {
    const m = /^(\d+)([.)])$/.exec(markText);
    if (m) return indent + (parseInt(m[1], 10) + 1) + m[2] + " " + task;
  }
  return indent + markText + " " + task;
}

/** Leading `indent + marker + trailing space(s)` of a list item line, including
 *  a task checkbox prefix so a task's soft-break hangs under its content too. */
const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/;

/**
 * The hang-indent (spaces) that aligns a soft-broken line under the CONTENT of
 * the enclosing list item — i.e. past its marker. Returns null outside a list.
 * Computed from the item's marker line so it's stable whether the caret is on
 * that line or already on a continuation line.
 */
function listHangIndent(
  state: Parameters<StateCommand>[0]["state"],
  pos: number,
): string | null {
  const tree = syntaxTree(state);
  let item: ReturnType<typeof tree.resolveInner> | null = null;
  for (
    let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, -1);
    n;
    n = n.parent
  ) {
    if (n.name === "ListItem") {
      item = n;
      break;
    }
  }
  if (!item) return null;
  const m = LIST_PREFIX.exec(state.doc.lineAt(item.from).text);
  return m ? " ".repeat(m[1].length) : null;
}

/**
 * Shift+Enter: a soft line break that stays in the current block with NO new
 * marker. Inside a list item the new line hangs under the item's content (the
 * default `insertNewlineAndIndent` only copies the line's own leading
 * whitespace, which on the marker line is nothing). Elsewhere, fall back.
 */
const insertSoftBreak: StateCommand = (target) => {
  const { state } = target;
  if (state.selection.ranges.length === 1) {
    const range = state.selection.main;
    if (range.empty && !inCode(state, range.from)) {
      const indent = listHangIndent(state, range.from);
      if (indent !== null) {
        target.dispatch(
          state.update({
            changes: { from: range.from, insert: "\n" + indent },
            selection: EditorSelection.cursor(range.from + 1 + indent.length),
            scrollIntoView: true,
            userEvent: "input",
          }),
        );
        return true;
      }
    }
  }
  return insertNewlineAndIndent(target);
};

/** Just the `marker + space` part of a list line (no leading indent, no task
 *  checkbox) — its length is one nesting level for that item. */
const MARKER_WIDTH = /^\s*((?:[-*+]|\d+[.)])\s+)/;

/**
 * If the caret on `pos`'s line is at/before a list item's CONTENT start (i.e.
 * within the leading indent + marker + optional checkbox), return how many spaces
 * one nesting level is — the marker width. Otherwise null (caret is in the
 * content, so Tab should insert a soft tab instead of nesting).
 *
 * Nesting by the MARKER width (not a fixed indentUnit) is essential for ordered
 * lists: `1. ` is 3 wide, so a 2-space indent wouldn't reach the parent's content
 * column and the item would fail to nest (it'd stay a flat sibling, numbering
 * 1,2,3…). Bullets are unaffected (`- ` is 2, same as the indent unit).
 */
function listNestWidth(state: Parameters<StateCommand>[0]["state"], pos: number): number | null {
  const line = state.doc.lineAt(pos);
  const full = LIST_PREFIX.exec(line.text); // indent + marker + space + optional [ ]
  if (!full || pos > line.from + full[1].length) return null;
  const mw = MARKER_WIDTH.exec(line.text);
  return mw ? mw[1].length : getIndentUnit(state);
}

/**
 * Tab inserts soft tabs (spaces per the active indentUnit) at the cursor, or
 * indents the selected lines. `insertTab` from @codemirror/commands inserts a
 * literal \t, so we roll our own to honor "Tab inserts spaces" (SPEC §4.4).
 *
 * Special case: with the caret at/before a list item's content start, Tab nests
 * the item by its marker width (so ordered lists actually nest), rather than
 * inserting spaces.
 */
const insertSoftTab: StateCommand = ({ state, dispatch }) => {
  const ranges = state.selection.ranges;
  if (ranges.some((r) => !r.empty)) return indentMore({ state, dispatch });
  const widths = ranges.map((r) => (inCode(state, r.from) ? null : listNestWidth(state, r.from)));
  if (widths.every((w) => w !== null)) {
    const changes = ranges.map((r, i) => ({
      from: state.doc.lineAt(r.from).from,
      insert: " ".repeat(widths[i] as number),
    }));
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
    return true;
  }
  dispatch(
    state.update(state.replaceSelection(indentString(state, getIndentUnit(state))), {
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

/**
 * Enter: continue the list/quote (new bullet, incremented ordinal) via
 * `insertNewlineContinueMarkup` — EXCEPT:
 * - on an EMPTY list item, where that command misbehaves (stray blank line +
 *   misindented bullet): nested empty item → outdent one level (`indentLess`);
 *   top-level empty item → exit the list (clear the marker → a plain line);
 * - on a CONTINUATION line of an item (soft-broken with Shift-Enter), where it
 *   inserts a bare newline instead of a marker → open a new sibling item.
 */
const listEnterOrExit: StateCommand = (target) => {
  const { state } = target;
  if (state.selection.ranges.length === 1) {
    const range = state.selection.main;
    if (range.empty && !inCode(state, range.from)) {
      const line = state.doc.lineAt(range.from);
      const m = EMPTY_LIST_ITEM.exec(line.text);
      if (m) {
        if (m[1].length > 0) return indentLess(target); // nested → outdent one level
        target.dispatch(
          state.update({
            changes: { from: line.from, to: line.to, insert: "" },
            selection: EditorSelection.cursor(line.from),
            userEvent: "delete",
          }),
        );
        return true;
      }
      const cont = listContinuationMarker(state, range.from);
      if (cont !== null) {
        target.dispatch(
          state.update({
            changes: { from: range.from, insert: "\n" + cont },
            selection: EditorSelection.cursor(range.from + 1 + cont.length),
            scrollIntoView: true,
            userEvent: "input",
          }),
        );
        return true;
      }
    }
  }
  return insertNewlineContinueMarkup(target);
};

/**
 * Editing keymap at high precedence (above the default keymap). The markdown
 * editing keys are re-added here EXPLICITLY (lang-markdown's own addKeymap is
 * disabled in setup.ts) so Enter beats the default keymap's plain newline:
 * - Enter → continue the list/quote, or exit on an empty top-level item.
 * - Backspace → markup-aware delete (outdent / un-marker).
 * - Shift+Enter → a soft line break with NO new marker, hung under list content.
 */
export const editingKeymap: Extension = Prec.high(
  keymap.of([
    { key: "Enter", run: listEnterOrExit },
    { key: "Backspace", run: deleteMarkupBackward },
    { key: "Shift-Enter", run: insertSoftBreak },
    { key: "Mod-b", run: toggleBold, preventDefault: true },
    { key: "Mod-i", run: toggleItalic, preventDefault: true },
    { key: "Mod-Shift-m", run: cycleRenderMode, preventDefault: true },
    { key: "Tab", run: insertSoftTab, shift: indentLess },
    // Enter a rendered table the caret is moving into (else CM skips the atomic
    // block). Both return false off a table edge, so normal nav is unaffected.
    { key: "ArrowDown", run: enterTableDown },
    { key: "ArrowUp", run: enterTableUp },
    // Cursor-context table edits (REQ-TBLED-5) — all return false outside a table,
    // so the chords are inert elsewhere. Insert/delete via gizmos + menu too (S3).
    { key: "Mod-Enter", run: insertRowBelow },
    { key: "Mod-Shift-Enter", run: insertRowAbove },
    { key: "Alt-Shift-ArrowDown", run: moveRowDown },
    { key: "Alt-Shift-ArrowUp", run: moveRowUp },
    { key: "Alt-Shift-ArrowLeft", run: moveColLeft },
    { key: "Alt-Shift-ArrowRight", run: moveColRight },
    // Re-tidy a hand-typed messy table to canonical GFM (inert outside a table).
    { key: "Mod-Alt-t", run: tidyTable, preventDefault: true },
  ]),
);
