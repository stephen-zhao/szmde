import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  RangeSet,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";
import {
  parseTable,
  insertRow,
  insertCol,
  moveRow,
  moveCol,
  tokenizeInline,
  headerPadChange,
  type Align,
  type Cell,
  type TableModel,
} from "./table-model";
import { showTableMenu, closeTableMenu } from "./table-menu";
import {
  setTableDisplay,
  tableDisplayAt,
  tableDisplays,
  type TableDisplay,
} from "./table-display";
import { tableBlockAt } from "./table-commands";
import { indexAt, type DragKind } from "./table-drag";
import { editCellAt, cancelCellEditor, commitCellEditor } from "./table-cell-editor";
import { replaceTable } from "./table-ops";

/**
 * Render a cell's inline markdown (bold / italic / strikethrough / inline code /
 * link) into `parent`, via the shared `tokenizeInline` (so the rendered DOM and the
 * click→source mapping never drift). Each segment is an element carrying
 * `data-seg-from` = its ABSOLUTE source offset (`baseOffset` + the segment's offset
 * within the cell), so a click on a rendered glyph maps to the exact source char —
 * including inside a formatted cell (REQ-TBLED-7, the M2 deferral). The editor's own
 * decoration pipeline can't be reused here (the widget is static DOM).
 */
export function renderInlineMarkdown(parent: HTMLElement, text: string, baseOffset = 0): void {
  for (const t of tokenizeInline(text)) {
    const name =
      t.kind === "strong"
        ? "strong"
        : t.kind === "del"
          ? "del"
          : t.kind === "code"
            ? "code"
            : t.kind === "link"
              ? "a"
              : t.kind === "em"
                ? "em"
                : "span";
    const el = document.createElement(name);
    el.textContent = t.text;
    el.dataset.segFrom = String(baseOffset + t.from);
    if (t.kind === "link") el.setAttribute("href", t.href!);
    parent.appendChild(el);
  }
}

/**
 * GFM tables (SPEC §5.1). Clean (Formatted) mode replaces the pipe-table source with
 * a real `<table>` block widget. The table STAYS rendered while you edit — clicking a
 * cell opens an inline editor over just that cell (`table-cell-editor.ts`); the table
 * never flips to raw pipes here (use Source mode for that). Structural editing — the
 * right-click menu, hover gizmos, and drag handles — operates on the source via
 * whole-table replaces, so the rendered table updates in place.
 *
 * Block-level / cross-line replacing decorations cannot be supplied from a
 * ViewPlugin (the editor needs them before computing vertical layout), so unlike
 * the other M2 constructs this is built from a **StateField** and provided via
 * `EditorView.decorations.from`.
 *
 * The cell map (text + source offsets + alignment) comes from the pure
 * `table-model.ts` (`parseTable`); this module is the CodeMirror adapter — locate
 * the `Table` block and render the model as a `<table>`.
 */

class TableWidget extends WidgetType {
  constructor(
    readonly m: TableModel, // full cell map + alignments; table start is m.from
    readonly key: string, // encodes the cell map AND the display modes → eq/rebuild
    readonly display: TableDisplay, // width mode + pin (REQ-TBLED-10/11)
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.key === this.key && o.m.from === this.m.from;
  }
  toDOM(view: EditorView) {
    const m = this.m;
    const table = document.createElement("table");
    table.className = "cm-md-table";
    table.setAttribute("contenteditable", "false");
    const align = (i: number): Align => m.aligns[i] ?? null;

    // A hover "+" affordance that inserts a row/column at a table edge (M5 S3b). Like
    // the menu ops it's a whole-table replace with the caret left OUTSIDE, so the
    // rendered table updates in place. The "+" glyph is a CSS ::before (not DOM text)
    // so it never leaks into a cell's textContent. tabindex -1: it's a hover-only
    // mouse affordance — the keyboard paths are the keymap + the right-click menu.
    const addGizmo = (
      cell: HTMLElement,
      cls: string,
      title: string,
      op: (model: TableModel) => TableModel,
    ) => {
      const g = document.createElement("button");
      g.className = `cm-tbl-gizmo ${cls}`;
      g.type = "button";
      g.tabIndex = -1;
      g.title = title;
      g.setAttribute("aria-label", title);
      g.addEventListener("mousedown", (e) => {
        // Primary button only — a right/middle-click must fall through (don't insert,
        // don't stopPropagation) so it reaches the contextmenu handler for the menu.
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        replaceTable(view, m.from, op); // commits an open cell editor + re-parses first
        view.focus();
      });
      cell.appendChild(g);
    };

    // A drag grip to reorder a row/column (M5 S5, REQ-TBLED-4). Shown on hover; on a
    // primary-button drag it pointer-captures, hit-tests the row/column under the
    // pointer (highlighting the drop target), and on release moves source → target as
    // a whole-table replace (caret left outside → in-place update). The drop math
    // (`indexAt`) and the move (`applyMove`) are pure + unit-tested; the gesture
    // (pointer capture + getBoundingClientRect) is layout-only, hence v8-ignored.
    const addDragGrip = (cell: HTMLElement, kind: DragKind, index: number) => {
      const g = document.createElement("span");
      g.className = `cm-tbl-drag cm-tbl-drag-${kind}`;
      g.title = kind === "row" ? "Drag to reorder row" : "Drag to reorder column";
      g.setAttribute("aria-hidden", "true");
      // A real pointer drag ALSO fires a compatibility mousedown on the grip; swallow
      // it so it can't bubble to the table's reveal-on-mousedown handler and abort the
      // drag (a synthetic PointerEvent doesn't emit this, so it's invisible to tests
      // that only dispatch pointer events — hence the dedicated mousedown test).
      g.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      g.addEventListener("pointerdown", (e) => {
        /* v8 ignore start -- pointer DnD gesture: needs real layout + pointer capture
           (happy-dom has neither); the drop index + the move are unit-tested separately. */
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          g.setPointerCapture(e.pointerId); // route move/up here even off the grip
        } catch {
          /* no active pointer (e.g. synthetic event) — the drag still tracks */
        }
        let target = index;
        const clearDrop = () =>
          table.querySelectorAll(".cm-tbl-drop").forEach((el) => el.classList.remove("cm-tbl-drop"));
        const spansNow = () =>
          kind === "row"
            ? [...table.tBodies[0].rows].map((r) => {
                const b = r.getBoundingClientRect();
                return { start: b.top, end: b.bottom };
              })
            : [...(table.tHead?.rows[0].cells ?? [])].map((c) => {
                const b = c.getBoundingClientRect();
                return { start: b.left, end: b.right };
              });
        const dropEl = (i: number): HTMLElement | undefined =>
          kind === "row" ? table.tBodies[0].rows[i] : table.tHead?.rows[0].cells[i];
        const onMove = (ev: PointerEvent) => {
          target = indexAt(kind === "row" ? ev.clientY : ev.clientX, spansNow());
          clearDrop();
          dropEl(target)?.classList.add("cm-tbl-drop");
        };
        const onUp = () => {
          g.removeEventListener("pointermove", onMove);
          g.removeEventListener("pointerup", onUp);
          clearDrop();
          if (index !== target)
            replaceTable(view, m.from, (model) =>
              kind === "row" ? moveRow(model, index, target) : moveCol(model, index, target),
            );
          view.focus();
        };
        g.addEventListener("pointermove", onMove);
        g.addEventListener("pointerup", onUp);
        /* v8 ignore stop */
      });
      cell.appendChild(g);
    };

    // `row` = -1 for a header cell, 0+ for a body row; carried as data-row/data-col
    // so the right-click menu knows which row + column the clicked cell belongs to.
    const fill = (el: HTMLTableCellElement, c: Cell, col: number, row: number) => {
      renderInlineMarkdown(el, c.text, c.from); // segments carry absolute data-seg-from
      el.dataset.cellFrom = String(c.from);
      el.dataset.row = String(row);
      el.dataset.col = String(col);
      if (align(col)) el.style.textAlign = align(col)!;
      // Header strip → column-insert handles (right edge of each; the first cell also
      // gets a leading-column handle on its left edge). Left gutter (col 0) → a
      // row-insert handle on each cell's bottom edge (the header's adds body row 0).
      if (row === -1) {
        addGizmo(el, "cm-tbl-gizmo-col", "Insert column right", (md) => insertCol(md, col + 1));
        if (col === 0) addGizmo(el, "cm-tbl-gizmo-colstart", "Insert column left", (md) => insertCol(md, 0));
        addDragGrip(el, "col", col); // drag the header cell to reorder its column
      }
      if (col === 0) {
        addGizmo(el, "cm-tbl-gizmo-row", "Insert row below", (md) => insertRow(md, row + 1));
        if (row >= 0) addDragGrip(el, "row", row); // drag a body row's first cell to reorder it
      }
    };

    const hr = table.createTHead().insertRow();
    m.header.forEach((c, i) => {
      const th = document.createElement("th");
      fill(th, c, i, -1);
      hr.appendChild(th);
    });

    const tbody = table.createTBody();
    m.rows.forEach((row, r) => {
      const tr = tbody.insertRow();
      row.forEach((c, i) => fill(tr.insertCell(), c, i, r));
    });
    // Left-clicking a cell opens the inline editor over it — the table stays rendered
    // (REQ-TBLED-7). A right/middle-click falls through (return) to the contextmenu
    // handler for the structural menu. stopPropagation keeps CM from placing a caret.
    table.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0) return;
      const cell = (e.target as HTMLElement | null)?.closest?.("[data-row]") as HTMLElement | null;
      if (cell) editCellAt(view, m.from, Number(cell.dataset.row), Number(cell.dataset.col));
    });
    // Right-click a cell → its structural-edit menu (insert/delete/move/align for
    // the cell's row + column — M5 S3b, REQ-TBLED-3/-5/-6). The menu ops keep the
    // caret outside the block, so the rendered table updates in place.
    table.addEventListener("contextmenu", (e) => {
      const cell = (e.target as HTMLElement | null)?.closest?.("[data-row]") as HTMLElement | null;
      if (!cell) return;
      e.preventDefault();
      e.stopPropagation();
      showTableMenu(view, m, Number(cell.dataset.row), Number(cell.dataset.col), e.clientX, e.clientY);
    });

    // Per-table display modes (REQ-TBLED-10 width, REQ-TBLED-11 pin) — display-only;
    // the on-disk GFM is untouched. Pin adds a sticky-header class (or the JS-follow
    // variant when combined with overflow, where the CSS sticky container breaks).
    if (this.display.pin) {
      table.classList.add(
        this.display.width === "overflow" ? "cm-md-table-pin-js" : "cm-md-table-pin",
      );
    }
    if (this.display.width !== "overflow") return table;
    return this.overflowWrap(view, table);
  }

  /**
   * Overflow width mode (REQ-TBLED-10): wrap the table in an independently-scrolling
   * box and size each column to its HEADER cell — header padding widens the column,
   * body content never does. Column widths need real layout, so the sizing is a
   * flicker-free pre-paint measure pass (v8-ignored — happy-dom has no layout; the DOM
   * STRUCTURE is unit-tested and the sizing is verified live in WF-34).
   */
  private overflowWrap(view: EditorView, table: HTMLTableElement): HTMLElement {
    table.classList.add("cm-md-table-overflow");
    // Stable <col> handles for the sizer plugin to pin each column's width onto.
    const colgroup = document.createElement("colgroup");
    for (let i = 0; i < this.m.header.length; i++) colgroup.appendChild(document.createElement("col"));
    table.insertBefore(colgroup, table.firstChild);
    // Preserve each header cell's padding (the raw leading/trailing spaces) as
    // preformatted spans so it occupies real width — the SPEC's explicit author control —
    // and give each header cell a right-border resize grip (REQ-TBLED-12) to drag the
    // padding (i.e. the column width) directly, no Source-mode round-trip.
    const ths = [...table.querySelectorAll<HTMLTableCellElement>("thead th")];
    ths.forEach((th, i) => {
      const raw = this.m.header[i]?.raw ?? "";
      const lead = raw.length - raw.trimStart().length;
      // For an all-whitespace cell trimStart already counts every space, so trimEnd would
      // double it — the whole segment is one leading pad run, no trailing run.
      const trail = raw.trim() === "" ? 0 : raw.length - raw.trimEnd().length;
      if (lead) th.insertBefore(padSpan(lead), th.firstChild);
      if (trail) th.appendChild(padSpan(trail));
      this.addColResizeGrip(view, th, i);
    });
    const scroll = document.createElement("div");
    scroll.className = "cm-md-table-scroll";
    scroll.appendChild(table);
    // The column sizing itself is a post-layout measure driven by overflowColumnSizer
    // (a ViewPlugin) — a requestMeasure scheduled from a block widget's toDOM doesn't
    // reliably apply, whereas one scheduled from a plugin update does.
    return scroll;
  }

  /**
   * A right-border resize grip on an overflow header cell (REQ-TBLED-12): dragging it
   * adds/removes that column's header **trailing padding** in whole-space steps — the
   * overflow column width. It rewrites the header cell's source in ONE undoable edit on
   * release (a targeted change, so it persists and survives structural ops), re-resolving
   * from the live doc first. Pure-layout gesture → v8-ignored (happy-dom has no layout /
   * pointer capture); the padding math is `headerPadChange` (unit-tested) and the live feel
   * is WF-verified. Only the STRUCTURE (the grip element) is exercised in the DOM tests.
   */
  private addColResizeGrip(view: EditorView, th: HTMLElement, colIndex: number): void {
    const grip = document.createElement("span");
    grip.className = "cm-tbl-colresize";
    grip.setAttribute("aria-hidden", "true");
    grip.title = "Drag to resize column (header padding)";
    // A real pointer drag also fires a compat mousedown; swallow it so it can't reach the
    // table's reveal/cell-edit handler.
    grip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    grip.addEventListener("pointerdown", (e) => {
      /* v8 ignore start -- pointer resize gesture: needs real layout + pointer capture
         (happy-dom has neither); the padding edit is unit-tested via headerPadChange. */
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const table = th.closest("table");
      const col = table?.querySelectorAll<HTMLElement>("colgroup > col")[colIndex];
      // px-per-space, from a rendered pad span (always ≥1 space in overflow) → the drag
      // maps 1:1 onto whole spaces. Fallback keeps it finite if no pad span is present.
      const padEl = th.querySelector<HTMLElement>(".cm-tbl-pad");
      const spaceW =
        padEl && padEl.textContent
          ? padEl.getBoundingClientRect().width / padEl.textContent.length
          : 8;
      const raw = this.m.header[colIndex]?.raw ?? "";
      const startTrail = Math.max(1, raw.length - raw.trimEnd().length);
      const startX = e.clientX;
      const baseColW = (col ?? th).getBoundingClientRect().width;
      let target = startTrail;
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic event — the drag still tracks */
      }
      const onMove = (ev: PointerEvent) => {
        target = Math.max(1, startTrail + Math.round((ev.clientX - startX) / Math.max(1, spaceW)));
        if (col) col.style.width = `${Math.max(0, baseColW + (target - startTrail) * spaceW)}px`;
      };
      const onUp = () => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        commitCellEditor(); // flush an open editor so offsets are valid, then re-resolve
        const tbl = tableBlockAt(view.state, this.m.from);
        if (tbl) {
          const fresh = parseTable(view.state.sliceDoc(tbl.from, tbl.to), tbl.from);
          const cell = fresh.header[colIndex];
          if (cell) view.dispatch({ changes: headerPadChange(cell, target), userEvent: "input" });
        }
        view.focus();
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
      /* v8 ignore stop */
    });
    th.appendChild(grip);
  }
  destroy() {
    closeTableMenu(); // table removed (re-render / scroll-away) → drop a stray menu
    // …and DISCARD an orphaned cell editor. We must NOT commit here: by the time a
    // structural op (or an external undo) rebuilds the widget, the editor's offsets
    // are stale, so committing would write to the wrong range. The structural ops
    // commit the editor THEMSELVES first (replaceTable), so a live edit isn't lost.
    cancelCellEditor();
  }
  /* v8 ignore start -- event plumbing; widget events aren't dispatched in happy-dom. */
  ignoreEvent(e: Event) {
    // Let CM see WHEEL events so scroll-zoom still works over the table — otherwise
    // shift+scroll can't change the page width and ctrl/cmd+scroll can't zoom the font
    // (REQ-ZOOM-1/2). The widget handles its own pointer events (cell clicks, gizmos,
    // drag grips, the context menu) and those stay ignored by the editor.
    return e.type !== "wheel";
  }
  /* v8 ignore stop */
}

/** A run of `n` spaces rendered preformatted (theme: white-space:pre), used to keep a
 *  header cell's padding width in overflow mode. aria-hidden: it's a display artifact. */
function padSpan(n: number): HTMLElement {
  const s = document.createElement("span");
  s.className = "cm-tbl-pad";
  s.textContent = " ".repeat(n);
  s.setAttribute("aria-hidden", "true");
  return s;
}

/* v8 ignore start -- column sizing + header-follow need real layout (getBoundingClientRect,
   forced reflow), which happy-dom lacks. The DOM structure these drive is unit-tested;
   the visual result is verified live (WF-34 overflow widths, WF-36 overflow+pin). */

/** Size every rendered overflow table so each column is exactly as wide as its HEADER
 *  cell (body content never widens it). One measure pass: with the body hidden + auto
 *  layout each header sizes to its own content; those widths are pinned onto the <col>s
 *  and the table switched to fixed layout. Pre-paint via requestMeasure → no flicker.
 *  Re-runs on geometry changes (zoom / page width) so the widths track the font. */
function sizeAllOverflowTables(view: EditorView): void {
  view.requestMeasure({
    key: "cm-md-table-overflow-size",
    read() {
      // Widths are pixels measured at the current font; if the editor font changes (zoom /
      // REQ-ZOOM) the widget isn't rebuilt, so we re-measure when the font differs. Merely
      // scrolling keeps the same font → the guard below skips (no per-scroll reflow).
      const fontKey = getComputedStyle(view.contentDOM).fontSize;
      const jobs: { colgroup: HTMLElement; table: HTMLTableElement; widths: number[] }[] = [];
      view.contentDOM.querySelectorAll(".cm-md-table-overflow").forEach((el) => {
        const table = el as HTMLTableElement;
        const colgroup = table.querySelector("colgroup") as HTMLElement | null;
        if (!colgroup) return;
        // Size each table's DOM instance once PER FONT: a rebuilt widget (doc / mode /
        // display change) gets a fresh colgroup with empty widths → re-measures; a font
        // change invalidates the stored key → re-measures; a plain scroll → skip (no reflow).
        const firstCol = colgroup.children[0] as HTMLElement | undefined;
        if (firstCol?.style.width && table.dataset.tblSizedFont === fontKey) return;
        const tbody = table.tBodies[0] as HTMLElement | undefined;
        const prevDisplay = tbody?.style.display ?? "";
        const prevLayout = table.style.tableLayout;
        const prevWidth = table.style.width;
        if (tbody) tbody.style.display = "none"; // isolate the header row
        table.style.tableLayout = "auto";
        table.style.width = "max-content";
        const widths = [...table.querySelectorAll<HTMLTableCellElement>("thead th")].map((th) =>
          Math.ceil(th.getBoundingClientRect().width),
        );
        if (tbody) tbody.style.display = prevDisplay;
        table.style.tableLayout = prevLayout;
        table.style.width = prevWidth;
        jobs.push({ colgroup, table, widths });
      });
      return { fontKey, jobs };
    },
    write({ fontKey, jobs }) {
      jobs.forEach(({ colgroup, table, widths }) => {
        const cols = [...colgroup.children] as HTMLElement[];
        widths.forEach((w, i) => {
          if (cols[i]) cols[i].style.width = `${w}px`;
        });
        table.style.tableLayout = "fixed";
        table.style.width = "max-content";
        table.dataset.tblSizedFont = fontKey; // stamp the font these widths were measured at
      });
    },
  });
}

/** Keep an overflow+pin table's header visible as the table scrolls vertically. In
 *  overflow mode the scroll wrapper's `overflow-x:auto` also clips `overflow-y`, which
 *  breaks a plain `position:sticky` header — so we translate the <thead> down manually
 *  to track the scroller top, clamped to the table's own vertical band. */
function syncPinnedHeaders(view: EditorView): void {
  view.requestMeasure({
    read() {
      const scrollTop = view.scrollDOM.getBoundingClientRect().top;
      const jobs: { thead: HTMLElement; shift: number }[] = [];
      view.contentDOM.querySelectorAll(".cm-md-table-pin-js").forEach((el) => {
        const table = el as HTMLTableElement;
        const thead = table.tHead as HTMLElement | null;
        if (!thead) return;
        const tRect = table.getBoundingClientRect();
        const maxShift = tRect.height - thead.getBoundingClientRect().height;
        const shift = Math.max(0, Math.min(scrollTop - tRect.top, maxShift));
        jobs.push({ thead, shift });
      });
      return jobs;
    },
    write(jobs) {
      jobs.forEach(({ thead, shift }) => {
        thead.style.position = "relative";
        thead.style.zIndex = "2";
        thead.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    },
  });
}
/* v8 ignore stop */

/** Drives the overflow column-sizing measure whenever an overflow table could need it:
 *  a doc/parse change, a display toggle, or a geometry change (zoom / page width). */
const overflowColumnSizer = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      sizeAllOverflowTables(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.geometryChanged ||
        u.transactions.some((t) => t.effects.some((e) => e.is(setTableDisplay)))
      ) {
        sizeAllOverflowTables(u.view);
      }
    }
  },
);

const pinnedTableHeaders = ViewPlugin.fromClass(
  class {
    private readonly onScroll: () => void;
    constructor(readonly view: EditorView) {
      this.onScroll = () => syncPinnedHeaders(view);
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      syncPinnedHeaders(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.geometryChanged ||
        u.viewportChanged ||
        u.transactions.some((t) => t.effects.some((e) => e.is(setTableDisplay)))
      ) {
        syncPinnedHeaders(u.view);
      }
    }
    destroy() {
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    }
  },
);

interface TableDecos {
  deco: DecorationSet;
  hidden: RangeSet<Decoration>;
}

const EMPTY: TableDecos = { deco: Decoration.none, hidden: RangeSet.empty };

function computeTableDecos(state: EditorState): TableDecos {
  if (state.facet(renderMode) !== "clean") return EMPTY;
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return undefined;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      // The table ALWAYS stays rendered in Clean mode now (no reveal-to-source);
      // cells are edited in place via the inline editor (table-cell-editor.ts).

      // M5 S1: build the cell map from the pure table-model, which parses columns
      // from PIPE GEOMETRY — so an empty cell isn't dropped (the lezer grammar emits
      // no TableCell node for it, and the old getChildren("TableCell") indexing then
      // mis-assigned alignment + click targets for any table with a blank cell).
      // lezer is used only to locate the Table block [from, to].
      const m = parseTable(state.doc.sliceString(from, to), from);

      // Fold the per-table display (width/pin) into the widget key, so toggling a mode
      // changes the key → eq() returns false → CM rebuilds the widget with the new DOM.
      const d = tableDisplayAt(state, from, to);
      const key = JSON.stringify([m.header, m.rows, m.aligns, d]);
      decos.push(
        Decoration.replace({
          widget: new TableWidget(m, key, d),
          block: true,
        }).range(from, to),
      );
      hidden.push(Decoration.replace({}).range(from, to));
      return false; // already extracted; don't descend into the table internals
    },
  });

  return { deco: Decoration.set(decos, true), hidden: RangeSet.of(hidden, true) };
}

const tableField = StateField.define<TableDecos>({
  create: computeTableDecos,
  update(value, tr) {
    // No `tr.selection` trigger: the table no longer reveals on caret-in, so the
    // decorations depend only on the doc / render mode / parse tree, not the cursor.
    if (
      tr.docChanged ||
      tr.startState.facet(renderMode) !== tr.state.facet(renderMode) ||
      // A display toggle (setTableDisplay) changes no text — WITHOUT this the widget
      // never rebuilds, so the mode flip wouldn't render (mirrors setup.ts fieldChanged).
      tr.startState.field(tableDisplays, false) !== tr.state.field(tableDisplays, false) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return computeTableDecos(tr.state);
    }
    return value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).hidden),
  ],
});

export const tableExtension: Extension = [tableField, overflowColumnSizer, pinnedTableHeaders];
