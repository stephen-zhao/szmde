import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSet, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";

/**
 * GFM task lists (`- [ ]` / `- [x]`, SPEC §5.1). The grammar nests a
 * `Task > TaskMarker` inside a `ListItem` (the `-` is still the `ListMark`).
 *
 * - **Clean (Formatted):** hide the `- ` list prefix and replace the `[ ]`/`[x]`
 *   marker with a real `<input type=checkbox>`. Clicking it toggles the on-disk
 *   char (`[ ]`⇄`[x]`). The checkbox is interactive content (like a bullet), so
 *   it's always rendered, not revealed on cursor; markers.ts suppresses the `•`
 *   bullet for task items in Clean mode.
 * - **Syntax / Source:** the `[ ]`/`[x]` chars are REAL content (they are the
 *   checkbox, not "just syntax"), so they are left as literal normal-size text —
 *   never the small-grey syntax-token style. markers.ts still greys the leading
 *   `-` (that IS a list marker).
 */
class TaskCheckbox extends WidgetType {
  constructor(
    readonly markerFrom: number, // position of the `[` so we can toggle the char
    readonly checked: boolean,
  ) {
    super();
  }
  eq(o: TaskCheckbox) {
    return o.markerFrom === this.markerFrom && o.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const cb = makeCheckbox(this.checked);
    // Don't let the click move the editor selection before our handler runs, and
    // don't let it steal editor focus (tabIndex -1 keeps it out of the tab order
    // so Tab stays a CodeMirror command, not a browser focus-traversal).
    cb.addEventListener("mousedown", (e) => e.preventDefault());
    cb.addEventListener("click", (e) => {
      e.preventDefault();
      const at = this.markerFrom + 1; // the char between the brackets
      view.dispatch({
        changes: { from: at, to: at + 1, insert: this.checked ? " " : "x" },
      });
    });
    return cb;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

function makeCheckbox(checked: boolean): HTMLInputElement {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "cm-md-task";
  cb.checked = checked;
  cb.tabIndex = -1; // not a browser tab stop
  cb.setAttribute("contenteditable", "false");
  return cb;
}

/**
 * An invisible clone of a task item's `checkbox + space` prefix, used in Clean
 * mode to indent a soft-broken CONTINUATION line so its text aligns under the
 * item's content — exactly like the bullet hang-indent, but the prefix glyph is
 * the checkbox (whose width is font/zoom-dependent, so literal spaces can't match).
 */
class TaskHangIndent extends WidgetType {
  /* v8 ignore start -- single shared decoration instance → CM reuses by
     reference and never calls eq; defensive only. */
  eq() {
    return true;
  }
  /* v8 ignore stop */
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-hang-indent"; // visibility:hidden, white-space:pre
    wrap.setAttribute("aria-hidden", "true");
    wrap.appendChild(makeCheckbox(false));
    wrap.appendChild(document.createTextNode(" "));
    return wrap;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

const hide = Decoration.replace({});
const taskHang = Decoration.replace({ widget: new TaskHangIndent() });

interface TaskDecos {
  decorations: DecorationSet;
  hidden: RangeSet<Decoration>;
}

/** Replace the leading whitespace of a task's continuation lines with the
 *  invisible checkbox-prefix clone (Clean mode), aligning text under content.
 *  A task's soft-broken continuation lines live INSIDE the `Task` node (there is
 *  no Paragraph child), so iterate the Task node's own lines. */
function pushTaskHangIndents(
  task: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>,
  state: EditorView["state"],
  decos: Range<Decoration>[],
  hidden: Range<Decoration>[],
) {
  const startLine = state.doc.lineAt(task.from).number;
  const endLine = state.doc.lineAt(task.to).number;
  for (let ln = startLine + 1; ln <= endLine; ln++) {
    const line = state.doc.line(ln);
    const ws = /^[ \t]*/.exec(line.text)![0].length;
    if (ws === 0) continue;
    decos.push(taskHang.range(line.from, line.from + ws));
    hidden.push(hide.range(line.from, line.from + ws));
  }
}

function buildTaskDecos(view: EditorView): TaskDecos {
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const { state } = view;
  const mode = state.facet(renderMode);
  if (mode !== "clean") return { decorations: Decoration.none, hidden: RangeSet.empty };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "TaskMarker") return;
        const marker = state.doc.sliceString(node.from, node.to); // "[ ]" or "[x]"
        const checked = /\[[xX]\]/.test(marker);

        // Hide the `- ` list prefix (ListMark up to the checkbox) so the checkbox
        // sits at the left margin with no leading bullet.
        const listItem = node.node.parent?.parent; // TaskMarker → Task → ListItem
        const listMark = listItem?.getChild("ListMark");
        if (listMark && listMark.to <= node.from) {
          hidden.push(hide.range(listMark.from, node.from));
          decos.push(hide.range(listMark.from, node.from));
        }
        const box = Decoration.replace({ widget: new TaskCheckbox(node.from, checked) });
        decos.push(box.range(node.from, node.to));
        hidden.push(hide.range(node.from, node.to));

        const task = node.node.parent; // TaskMarker → Task (holds continuation lines)
        if (task) pushTaskHangIndents(task, state, decos, hidden);
      },
    });
  }
  return {
    decorations: Decoration.set(decos, true),
    hidden: RangeSet.of(hidden, true),
  };
}

export const taskDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hidden: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const r = buildTaskDecos(view);
      this.decorations = r.decorations;
      this.hidden = r.hidden;
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.facet(renderMode) !== u.state.facet(renderMode) ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        const r = buildTaskDecos(u.view);
        this.decorations = r.decorations;
        this.hidden = r.hidden;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Make the hidden `- ` prefix, the checkbox, and the hang-indent atomic. */
export const taskAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(taskDecorations)?.hidden ?? RangeSet.empty,
);
