import { EditorSelection, Prec } from "@codemirror/state";
import type { Extension, StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentLess, indentMore, insertNewlineAndIndent } from "@codemirror/commands";
import { getIndentUnit, indentString, syntaxTree } from "@codemirror/language";
import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { cycleRenderMode } from "./render-mode";

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

/** An empty list item: leading indent (captured as group 1) + marker + space.
 *  Shared by the Tab (nest) and Enter (outdent/exit) handlers. */
const EMPTY_LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+$/;

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
  if (item.parent?.name === "OrderedList") {
    const m = /^(\d+)([.)])$/.exec(markText);
    if (m) return indent + (parseInt(m[1], 10) + 1) + m[2] + " ";
  }
  return indent + markText + " ";
}

/** Leading `indent + marker + trailing space(s)` of a list item line. */
const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+)/;

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

/**
 * Tab inserts soft tabs (spaces per the active indentUnit) at the cursor, or
 * indents the selected lines. `insertTab` from @codemirror/commands inserts a
 * literal \t, so we roll our own to honor "Tab inserts spaces" (SPEC §4.4).
 *
 * Special case: on an EMPTY list item (only a marker + space), Tab increases the
 * item's nesting level (indentMore) rather than inserting spaces at the cursor.
 */
const insertSoftTab: StateCommand = ({ state, dispatch }) => {
  const ranges = state.selection.ranges;
  if (ranges.some((r) => !r.empty)) return indentMore({ state, dispatch });
  if (
    ranges.every(
      (r) => !inCode(state, r.from) && EMPTY_LIST_ITEM.test(state.doc.lineAt(r.from).text),
    )
  ) {
    return indentMore({ state, dispatch });
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
  ]),
);
