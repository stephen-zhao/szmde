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

/* v8 ignore start -- caretPositionFromPoint/caretRangeFromPoint need real layout,
   which happy-dom doesn't provide; the in-name char mapping runs in the WebView. */
function caretOffsetIn(node: HTMLElement, x: number, y: number): number | null {
  const doc = node.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos && node.contains(pos.offsetNode)) return pos.offset;
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range && node.contains(range.startContainer)) return range.startOffset;
  return null;
}
/* v8 ignore stop */

/**
 * Icon + name shown in place of `[!TYPE]` on the title line (Clean mode). A DOM
 * mousedown listener on the widget (CM's reliable path for clicks ON a widget —
 * editor-level domEventHandlers don't fire for them) reveals the literal
 * `[!TYPE]` and drops the caret at the clicked character: within the type name
 * the rendered name maps 1:1 onto the source name (after the `[!`); elsewhere the
 * label start.
 */
class AlertLabelWidget extends WidgetType {
  constructor(
    readonly type: AlertType,
    readonly markFrom: number, // doc position of the `[` of `[!TYPE]`
  ) {
    super();
  }
  eq(o: AlertLabelWidget) {
    return o.type === this.type && o.markFrom === this.markFrom;
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
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      let at = this.markFrom;
      /* v8 ignore start -- char-from-point is the real-DOM path (not in happy-dom). */
      const nameEl = (e.target as HTMLElement | null)?.closest?.(".cm-alert-name") as HTMLElement | null;
      if (nameEl) {
        const off = caretOffsetIn(nameEl, e.clientX, e.clientY);
        if (off != null) at = this.markFrom + 2 + off; // `[`(+0) `!`(+1) name(+2…)
      }
      /* v8 ignore stop */
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
          const open = first.text.indexOf("["); // the `[` of `[!TYPE]`
          const close = first.text.indexOf("]");
          if (pfx && open !== -1 && close !== -1) {
            const labelTo = first.from + close + 1; // through the `]`
            const markFrom = first.from + open; // the `[`. markers.ts hides the `> ` up to
            // here (incl. the syntax space), so the label replace must start at the `[` — not
            // after the `>` — or the two replace decorations would overlap.
            decos.push(
              Decoration.replace({ widget: new AlertLabelWidget(type, markFrom) }).range(
                markFrom,
                labelTo,
              ),
            );
            hidden.push(hide.range(markFrom, labelTo));
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
