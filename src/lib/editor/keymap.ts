import { EditorSelection, Prec } from "@codemirror/state";
import type { Extension, StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentLess, indentMore, insertNewlineAndIndent } from "@codemirror/commands";
import { getIndentUnit, indentString, indentUnit, syntaxTree } from "@codemirror/language";
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
 * `insertNewlineContinueMarkup` — EXCEPT on an EMPTY list item, where that
 * command misbehaves (stray blank line + misindented bullet). Instead:
 * - nested empty item → outdent one level (`indentLess`);
 * - top-level empty item → exit the list (clear the marker → a plain line).
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
 * - Shift+Enter → a continuation line (newline + indent) with NO new marker.
 */
export const editingKeymap: Extension = Prec.high(
  keymap.of([
    { key: "Enter", run: listEnterOrExit },
    { key: "Backspace", run: deleteMarkupBackward },
    { key: "Shift-Enter", run: insertNewlineAndIndent },
    { key: "Mod-b", run: toggleBold, preventDefault: true },
    { key: "Mod-i", run: toggleItalic, preventDefault: true },
    { key: "Mod-Shift-m", run: cycleRenderMode, preventDefault: true },
    { key: "Tab", run: insertSoftTab, shift: indentLess },
  ]),
);

/** Indentation unit: 2 spaces (soft tabs). Made configurable in S6. */
export const indentExtension: Extension = indentUnit.of("  ");
