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
 *   char (`[ ]`⇄`[x]`) — the file stays the source of truth. The checkbox is
 *   interactive content (like a bullet), so it is always rendered, not revealed
 *   on cursor; markers.ts suppresses the `•` bullet for task items in Clean mode.
 * - **Syntax / Source:** leave the literal `[ ]`/`[x]` text (markers.ts greys the
 *   `-` in Syntax). No checkbox.
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
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "cm-md-task";
    cb.checked = this.checked;
    cb.setAttribute("contenteditable", "false");
    // Don't let the click move the editor selection before our handler runs.
    cb.addEventListener("mousedown", (e) => e.preventDefault());
    cb.addEventListener("click", (e) => {
      e.preventDefault();
      // Flip the char between the brackets: `[ ]` ⇄ `[x]`.
      const at = this.markerFrom + 1;
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

const hide = Decoration.replace({});
const syntaxMark = Decoration.mark({ class: "cm-md-mark-syntax" });

interface TaskDecos {
  decorations: DecorationSet;
  hidden: RangeSet<Decoration>;
}

function buildTaskDecos(view: EditorView): TaskDecos {
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const { state } = view;
  const mode = state.facet(renderMode);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "TaskMarker") return;
        const marker = state.doc.sliceString(node.from, node.to); // "[ ]" or "[x]"
        const checked = /\[[xX]\]/.test(marker);

        if (mode === "clean") {
          // Hide the `- ` list prefix (from the ListMark up to the checkbox) so
          // the checkbox sits at the left margin with no leading bullet.
          const listItem = node.node.parent?.parent; // TaskMarker → Task → ListItem
          const listMark = listItem?.getChild("ListMark");
          if (listMark && listMark.to <= node.from) {
            hidden.push(hide.range(listMark.from, node.from));
            decos.push(hide.range(listMark.from, node.from));
          }
          const box = Decoration.replace({ widget: new TaskCheckbox(node.from, checked) });
          decos.push(box.range(node.from, node.to));
          hidden.push(hide.range(node.from, node.to));
        } else if (mode === "markers-syntax") {
          decos.push(syntaxMark.range(node.from, node.to));
        }
        // markers-rendered: leave the literal marker untouched.
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

/** Make the hidden `- ` prefix and the checkbox atomic (arrow-skip / single delete). */
export const taskAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(taskDecorations)?.hidden ?? RangeSet.empty,
);
