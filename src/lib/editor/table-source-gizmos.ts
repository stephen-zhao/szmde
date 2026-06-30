import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";
import { parseTable, serialize, insertRow, insertCol, type TableModel } from "./table-model";

/**
 * Source / Syntax-mode table edit gizmos (M5 S3c). In the non-Clean modes a GFM
 * table is plain pipe text (no `<table>` widget), so the Formatted-mode hover gizmos
 * don't apply. This adds the same hover "+" affordances over the raw source:
 * column-insert handles on the header row's pipe characters, and a row-insert handle
 * at each table line's edge (the gap to the next line). Both reuse the pure model ops
 * and dispatch ONE whole-table replace.
 *
 * These are the MOUSE affordances for inserting. Keyboard parity is partial: row
 * insert (`Mod-Enter`/`Mod-Shift-Enter`) and the row/column MOVES (`Alt-Shift-Arrows`)
 * are bound in every mode via `structuralCommand`, but column INSERT and the deletes
 * have no keybinding — they're reachable only here (and the Formatted right-click
 * menu). Clean mode is skipped (the rendered table carries its own gizmos + menu).
 */

// Re-resolve the Table block containing `pos` at click time (positions may have
// shifted since the decoration was built) — mirrors the structural commands.
function resolveTable(state: EditorState, pos: number): { from: number; to: number } | null {
  const tree = syntaxTree(state);
  for (
    let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (n.name === "Table") {
      return { from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to };
    }
  }
  /* v8 ignore start -- a gizmo only exists on a live Table, so the walk always hits one */
  return null;
  /* v8 ignore stop */
}

function applyAt(view: EditorView, anchor: number, op: (m: TableModel) => TableModel): void {
  const tbl = resolveTable(view.state, anchor);
  if (!tbl) return; // defensive: the table could only vanish via a concurrent edit
  const m = parseTable(view.state.doc.sliceString(tbl.from, tbl.to), tbl.from);
  // The source gizmos only ever insert (never a no-op), so a whole-table replace.
  view.dispatch({ changes: { from: tbl.from, to: tbl.to, insert: serialize(op(m)) } });
  view.focus();
}

type GizKind = "col" | "colstart" | "row";

class SrcGizmo extends WidgetType {
  constructor(
    readonly kind: GizKind,
    readonly index: number, // the insert index for the op
    readonly anchor: number, // a stable position inside the table (re-resolve target)
    readonly title: string,
  ) {
    super();
  }
  eq(o: SrcGizmo) {
    return o.kind === this.kind && o.index === this.index && o.anchor === this.anchor;
  }
  toDOM(view: EditorView): HTMLElement {
    // Zero-width anchor so the gizmo never shifts the pipe text; the "+" button is
    // absolutely positioned off it. The glyph is a CSS ::before (out of textContent).
    const wrap = document.createElement("span");
    wrap.className = "cm-tbl-src-anchor";
    const b = document.createElement("button");
    b.className = `cm-tbl-src-gizmo cm-tbl-src-${this.kind}`;
    b.type = "button";
    b.tabIndex = -1;
    b.title = this.title;
    b.setAttribute("aria-label", this.title);
    const op = (m: TableModel): TableModel =>
      this.kind === "row" ? insertRow(m, this.index) : insertCol(m, this.index);
    b.addEventListener("mousedown", (e) => {
      // Primary button only; let a right/middle-click fall through to normal editing.
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      applyAt(view, this.anchor, op);
    });
    wrap.appendChild(b);
    return wrap;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

/** Unescaped pipe offsets within a line (ports the splitRow esc-flag walk). */
function findPipes(line: string): number[] {
  const pipes: number[] = [];
  let esc = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (esc) esc = false;
    else if (c === "\\") esc = true;
    else if (c === "|") pipes.push(i);
  }
  return pipes;
}

function buildSrcGizmos(state: EditorState): DecorationSet {
  if (state.facet(renderMode) === "clean") return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return undefined;
      const startLine = state.doc.lineAt(node.from).number;
      const endLine = state.doc.lineAt(node.to - 1).number;
      const header = state.doc.line(startLine);

      // Column handles on the header row's pipes. A leading pipe is boundary 0; each
      // subsequent structural pipe advances the boundary. insertCol clamps the index,
      // so a ragged (no-edge-pipe) row degrades gracefully.
      const pipes = findPipes(header.text);
      const lead = pipes.length > 0 && header.text.slice(0, pipes[0]).trim() === "";
      pipes.forEach((p, k) => {
        const index = lead ? k : k + 1;
        const kind: GizKind = index === 0 ? "colstart" : "col";
        builder.add(
          header.from + p,
          header.from + p,
          Decoration.widget({
            widget: new SrcGizmo(kind, index, header.from, "Insert column here"),
            side: index === 0 ? -1 : 1,
          }),
        );
      });

      // Row handles at each table line's edge: the header adds the first body row
      // (index 0); a body row adds the row below it. The delimiter line is skipped.
      for (let ln = startLine; ln <= endLine; ln++) {
        if (ln === startLine + 1) continue;
        const line = state.doc.line(ln);
        const index = ln === startLine ? 0 : ln - startLine - 1; // header→0; body b→b+1
        builder.add(
          line.to,
          line.to,
          Decoration.widget({
            widget: new SrcGizmo("row", index, line.from, "Insert row below"),
            side: 1,
          }),
        );
      }
      return false;
    },
  });
  return builder.finish();
}

export const tableSourceGizmos = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildSrcGizmos(view.state);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.startState.facet(renderMode) !== u.state.facet(renderMode) ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = buildSrcGizmos(u.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
