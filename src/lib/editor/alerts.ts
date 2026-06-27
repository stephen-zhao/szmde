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
  constructor(readonly type: AlertType) {
    super();
  }
  eq(o: AlertLabelWidget) {
    return o.type === this.type;
  }
  toDOM() {
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
    return wrap;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

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
 * Caret target for a click on the alert label: the position of `[!TYPE]`, plus
 * the clicked character offset within the type name (the rendered name maps 1:1
 * onto the source name, after the `[!`). Pure (the base case is testable); the
 * char-from-point branch is the real-DOM path.
 */
export function alertLabelPos(
  view: EditorView,
  label: HTMLElement,
  nameEl: HTMLElement | null,
  x: number,
  y: number,
): number {
  const base = view.posAtDOM(label); // start of `[!TYPE]`
  /* v8 ignore start -- char-from-point mapping is the real-DOM path. */
  if (nameEl) {
    const off = caretOffsetIn(nameEl, x, y);
    if (off != null) return base + 2 + off; // skip the literal `[!` before the name
  }
  /* v8 ignore stop */
  return base;
}

/**
 * Clicking the rendered alert label reveals the literal `[!TYPE]` with the caret
 * at the clicked character. Uses CM's domEventHandlers (return true fully takes
 * over) — a listener on the widget loses to CM's built-in inline-widget caret
 * placement, which lands at the atomic-range edge ("start or end").
 */
/* v8 ignore start -- DOM-event wrapper: CM fires it on real pointer events,
   which happy-dom can't dispatch through CM's plumbing. Logic is alertLabelPos. */
export const alertInteraction = EditorView.domEventHandlers({
  mousedown(e, view) {
    const el = e.target as HTMLElement | null;
    const label = el?.closest?.(".cm-alert-label") as HTMLElement | null;
    if (!label) return false;
    const name = el?.closest?.(".cm-alert-name") as HTMLElement | null;
    const at = alertLabelPos(view, label, name, e.clientX, e.clientY);
    view.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true });
    e.preventDefault();
    return true;
  },
});
/* v8 ignore stop */

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
              Decoration.replace({ widget: new AlertLabelWidget(type) }).range(labelFrom, labelTo),
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
