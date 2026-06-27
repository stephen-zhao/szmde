import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { alertType } from "./alerts";

/**
 * Line decorations for block constructs: heading line spacing and the blockquote
 * left bar. (Code blocks and frontmatter are handled by their own plugin in
 * setup.ts; markers are hidden/styled by markers.ts.)
 *
 * Classes are collected per line into a Map first, then emitted once per line in
 * sorted order — so nested blocks (e.g. a heading inside a blockquote) combine
 * their classes on one line without any out-of-order RangeSetBuilder adds.
 */
const lineDecoCache = new Map<string, Decoration>();
function lineDeco(cls: string): Decoration {
  let d = lineDecoCache.get(cls);
  if (!d) {
    d = Decoration.line({ class: cls });
    lineDecoCache.set(cls, d);
  }
  return d;
}

function buildBlockConstructDecos(view: EditorView): DecorationSet {
  const { state } = view;
  const classes = new Map<number, string[]>();
  const add = (line: number, cls: string) => {
    const a = classes.get(line);
    if (a) a.push(cls);
    else classes.set(line, [cls]);
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        if (/^ATXHeading[1-6]$/.test(name)) {
          add(state.doc.lineAt(node.from).number, "cm-h" + name[name.length - 1]);
        } else if (name === "Blockquote") {
          // Alerts (`> [!NOTE]`) are styled as callout boxes by alerts.ts, not as
          // the plain quote bar — skip them here so the two don't double up.
          if (alertType(state, node.node)) return;
          const startLine = state.doc.lineAt(node.from).number;
          const endLine = state.doc.lineAt(node.to - 1).number;
          const lo = Math.max(startLine, state.doc.lineAt(Math.max(node.from, from)).number);
          const hi = Math.min(endLine, state.doc.lineAt(Math.min(node.to - 1, to)).number);
          for (let n = lo; n <= hi; n++) add(n, "cm-blockquote");
        }
      },
    });
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const n of [...classes.keys()].sort((a, b) => a - b)) {
    const line = state.doc.line(n);
    builder.add(line.from, line.from, lineDeco(classes.get(n)!.join(" ")));
  }
  return builder.finish();
}

export const blockConstructDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildBlockConstructDecos(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = buildBlockConstructDecos(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
