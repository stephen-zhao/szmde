import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { indentUnit, syntaxTree } from "@codemirror/language";

export type IndentStyle = "spaces" | "tab";
export interface IndentConfig {
  style: IndentStyle;
  width: number;
}

export const indentCompartment = new Compartment();

/** The indent-unit string for a config: a tab, or `width` spaces. */
export function indentUnitString(c: IndentConfig): string {
  return c.style === "tab" ? "\t" : " ".repeat(Math.max(1, c.width));
}

function indentValue(c: IndentConfig): Extension {
  return [indentUnit.of(indentUnitString(c)), EditorState.tabSize.of(Math.max(1, c.width))];
}

export function indentExtension(c: IndentConfig): Extension {
  return indentCompartment.of(indentValue(c));
}

export function setIndent(view: EditorView, c: IndentConfig) {
  view.dispatch({ effects: indentCompartment.reconfigure(indentValue(c)) });
}

export function indentConfigOf(state: EditorState): IndentConfig {
  const u = state.facet(indentUnit);
  if (u[0] === "\t") return { style: "tab", width: state.tabSize };
  return { style: "spaces", width: u.length || 2 };
}

/** Visual column width of leading whitespace, given a tab size. */
function columnWidth(ws: string, tabSize: number): number {
  let col = 0;
  for (const ch of ws) col += ch === "\t" ? tabSize - (col % tabSize) : 1;
  return col;
}

/**
 * Rewrite every line's leading whitespace into the target indent style
 * (default: the current one), preserving visual width. Skips fenced-code
 * interiors. One undoable transaction.
 */
export function convertIndentation(view: EditorView, to: IndentConfig = indentConfigOf(view.state)) {
  const { state } = view;
  const tabSize = state.tabSize;
  const skip = new Set<number>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const s = state.doc.lineAt(node.from).number;
      const e = state.doc.lineAt(node.to - 1).number;
      for (let n = s; n <= e; n++) skip.add(n);
    },
  });
  const w = Math.max(1, to.width);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    if (skip.has(i)) continue;
    const line = state.doc.line(i);
    const m = /^[ \t]+/.exec(line.text);
    if (!m) continue;
    const col = columnWidth(m[0], tabSize);
    const levels = Math.floor(col / w);
    const rem = col % w;
    const next = (to.style === "tab" ? "\t".repeat(levels) : " ".repeat(levels * w)) + " ".repeat(rem);
    if (next !== m[0]) changes.push({ from: line.from, to: line.from + m[0].length, insert: next });
  }
  if (changes.length) view.dispatch({ changes, userEvent: "input.indent" });
}
