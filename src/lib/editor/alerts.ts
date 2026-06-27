import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { EditorSelection, RangeSet, type EditorState, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";

/**
 * GFM alerts / callouts (SPEC §5.1). These are NOT a Lezer node — `> [!NOTE]`
 * parses as a plain Blockquote whose first content line is exactly `[!TYPE]`. So
 * we detect them: a blockquote is an alert iff de-quoting its first line matches
 * `[!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`.
 *
 * - The **callout box** (per-line `cm-alert cm-alert-<type>` classes, plus
 *   `cm-alert-title` on the first line) renders in **every** mode — it's a block
 *   construct, like a heading's size.
 * - In **Clean** mode the `[!TYPE]` label is replaced by an icon + name widget
 *   (atomic), revealed back to the literal text when the caret is on that line.
 *   Source/Syntax keep the literal `[!TYPE]`.
 */
export const ALERT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
const QUOTE_PREFIX = /^(\s*>)(\s?)/; // the `>` (with any leading/trailing space)

/** The alert type for a Blockquote node, or null if it isn't an alert. */
export function alertType(state: EditorState, bq: SyntaxNode): AlertType | null {
  const first = state.doc.lineAt(bq.from);
  const content = first.text.replace(QUOTE_PREFIX, "");
  const m = ALERT_RE.exec(content);
  return m ? (m[1].toLowerCase() as AlertType) : null;
}

const TITLE: Record<AlertType, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

/** Icon + name shown in place of `[!TYPE]` on the title line (Clean mode). */
class AlertLabelWidget extends WidgetType {
  constructor(
    readonly type: AlertType,
    readonly pos: number, // where to drop the caret when the label is clicked
  ) {
    super();
  }
  eq(o: AlertLabelWidget) {
    return o.type === this.type && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = `cm-alert-label cm-alert-label-${this.type}`;
    wrap.setAttribute("contenteditable", "false");
    const icon = document.createElement("span");
    icon.className = "cm-alert-icon";
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "cm-alert-name";
    name.textContent = TITLE[this.type];
    wrap.append(icon, name);
    // Clicking the label reveals the literal `[!TYPE]` for editing, with the caret
    // at the clicked position (posAtCoords maps the click to a doc offset; falls
    // back to the label start). stopPropagation beats CM's own mousedown handling.
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const at = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? this.pos;
      view.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

const hide = Decoration.replace({});
const lineCache = new Map<string, Decoration>();
function lineDeco(cls: string): Decoration {
  let d = lineCache.get(cls);
  if (!d) lineCache.set(cls, (d = Decoration.line({ class: cls })));
  return d;
}

interface AlertDecos {
  decorations: DecorationSet;
  hidden: RangeSet<Decoration>;
}

function buildAlertDecos(view: EditorView): AlertDecos {
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const { state } = view;
  const mode = state.facet(renderMode);

  // Reveal-on-cursor (Clean only): a caret on the title line shows literal text.
  const caretLines = new Set<number>();
  if (mode === "clean") {
    for (const sel of state.selection.ranges) {
      caretLines.add(state.doc.lineAt(sel.from).number);
      caretLines.add(state.doc.lineAt(sel.to).number);
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Blockquote") return;
        const type = alertType(state, node.node);
        if (!type) return;

        const startLine = state.doc.lineAt(node.from).number;
        const endLine = state.doc.lineAt(node.to - 1).number;
        const lo = Math.max(startLine, state.doc.lineAt(Math.max(node.from, from)).number);
        const hi = Math.min(endLine, state.doc.lineAt(Math.min(node.to - 1, to)).number);
        for (let n = lo; n <= hi; n++) {
          const line = state.doc.line(n);
          const cls = n === startLine ? `cm-alert cm-alert-${type} cm-alert-title` : `cm-alert cm-alert-${type}`;
          decos.push(lineDeco(cls).range(line.from, line.from));
        }

        // Title-line label → widget (Clean mode, unless the caret is on it).
        if (mode === "clean" && !caretLines.has(startLine)) {
          const first = state.doc.line(startLine);
          const pfx = QUOTE_PREFIX.exec(first.text);
          const close = first.text.indexOf("]");
          if (pfx && close !== -1) {
            const labelFrom = first.from + pfx[1].length; // right after the `>`
            const labelTo = first.from + close + 1; // through the `]`
            decos.push(
              Decoration.replace({ widget: new AlertLabelWidget(type, labelFrom) }).range(
                labelFrom,
                labelTo,
              ),
            );
            hidden.push(hide.range(labelFrom, labelTo));
          }
        }
      },
    });
  }
  return {
    decorations: Decoration.set(decos, true),
    hidden: RangeSet.of(hidden, true),
  };
}

export const alertDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hidden: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const r = buildAlertDecos(view);
      this.decorations = r.decorations;
      this.hidden = r.hidden;
    }
    update(u: ViewUpdate) {
      const cleanNow = u.state.facet(renderMode) === "clean";
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.facet(renderMode) !== u.state.facet(renderMode) ||
        (cleanNow && u.selectionSet) ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        const r = buildAlertDecos(u.view);
        this.decorations = r.decorations;
        this.hidden = r.hidden;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Make the Clean-mode `[!TYPE]` label atomic (arrow-skip / single delete). */
export const alertAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(alertDecorations)?.hidden ?? RangeSet.empty,
);
