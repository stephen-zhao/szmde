import {
  EditorView,
  keymap,
  Decoration,
  ViewPlugin,
  WidgetType,
  BlockWrapper,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  Compartment,
  Facet,
  Prec,
  RangeSet,
  RangeSetBuilder,
  RangeValue,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type { EditorState, Extension, Range, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { baseTheme, markdownHighlight } from "./theme";
import { Frontmatter } from "./frontmatter";
import {
  cleanModeContentAttr,
  renderMode,
  renderModeCompartment,
  type RenderMode,
} from "./render-mode";
import { markerDecorations, markerAtomicRanges } from "./markers";
import { blockConstructDecorations } from "./blocks";
import { hrDecorations, hrAtomicRanges } from "./hr";
import { taskDecorations, taskAtomicRanges } from "./tasks";
import { imageDecorations, imageAtomicRanges } from "./images";
import { editingKeymap } from "./keymap";
import { indentExtension, type IndentConfig } from "./indent";

// ---------------------------------------------------------------------------
// Word-wrap state for code blocks
//
// `codeBlockWrap` (a facet, set via `codeWrapCompartment`) is the EDITOR-WIDE
// default. Individual blocks can override it; overrides live in the
// `wrapOverrides` StateField (a RangeSet mapped across edits). The effective
// wrap for a block is its override if present, else the editor-wide default.
// ---------------------------------------------------------------------------
export const codeBlockWrap = Facet.define<boolean, boolean>({
  combine: (vals) => (vals.length ? vals[0] : true),
});
export const codeWrapCompartment = new Compartment();

class WrapOverride extends RangeValue {
  constructor(readonly wrap: boolean) {
    super();
  }
  /* v8 ignore start -- RangeValue.eq is CM-internal set-diff plumbing; the
     wrapOverrides field is read via between(), which never invokes eq. */
  eq(other: RangeValue) {
    return other instanceof WrapOverride && other.wrap === this.wrap;
  }
  /* v8 ignore stop */
}

const setBlockWrap = StateEffect.define<{ from: number; to: number; wrap: boolean }>();
const clearBlockWraps = StateEffect.define<null>();

const wrapOverrides = StateField.define<RangeSet<WrapOverride>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearBlockWraps)) {
        set = RangeSet.empty;
      } else if (e.is(setBlockWrap)) {
        const { from, to, wrap } = e.value;
        set = set.update({
          filterFrom: from,
          filterTo: to,
          filter: () => false, // drop any existing override over this block
          add: [new WrapOverride(wrap).range(from, to)],
        });
      }
    }
    return set;
  },
});

/** The effective wrap for the code block spanning [from, to). */
function effectiveWrap(state: EditorState, from: number, to: number): boolean {
  let wrap = state.facet(codeBlockWrap);
  const set = state.field(wrapOverrides, false);
  if (set) {
    set.between(from, to, (_f, _t, v) => {
      wrap = v.wrap;
      return false; // first match wins
    });
  }
  return wrap;
}

/** Tri-state for the editor-wide menu control. */
export type WrapState = "on" | "off" | "partial";
export function wrapStateOf(state: EditorState): WrapState {
  const def = state.facet(codeBlockWrap);
  const overrides = state.field(wrapOverrides, false);
  let differs = false;
  if (overrides) {
    // Only count overrides that actually differ from the editor-wide default —
    // toggling a block off then on leaves a redundant (==default) override that
    // shouldn't keep the menu stuck on "partial".
    overrides.between(0, state.doc.length, (_f, _t, v) => {
      if (v.wrap !== def) {
        differs = true;
        return false;
      }
    });
  }
  return differs ? "partial" : def ? "on" : "off";
}

/** Set the editor-wide default and clear all per-block overrides. */
export function setGlobalWrap(view: EditorView, wrap: boolean) {
  view.dispatch({
    effects: [
      codeWrapCompartment.reconfigure(codeBlockWrap.of(wrap)),
      clearBlockWraps.of(null),
    ],
  });
}

// ---------------------------------------------------------------------------
// Per-block wrap toggle widget (sits in the code block's header bar)
// ---------------------------------------------------------------------------
class WrapToggleWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly wrap: boolean,
  ) {
    super();
  }
  eq(o: WrapToggleWidget) {
    return o.from === this.from && o.to === this.to && o.wrap === this.wrap;
  }
  toDOM(view: EditorView) {
    const b = document.createElement("span");
    b.className = "cm-cb-wraptoggle";
    b.textContent = this.wrap ? "wrap" : "no-wrap";
    b.setAttribute("title", "Toggle word wrap for this code block");
    b.setAttribute("contenteditable", "false");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({
        effects: setBlockWrap.of({ from: this.from, to: this.to, wrap: !this.wrap }),
      });
    });
    return b;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

// ---------------------------------------------------------------------------
// Line decorations: fence header/footer, code content lines, frontmatter
// ---------------------------------------------------------------------------
const cbOpen = Decoration.line({ class: "cm-cb-line cm-cb-open" });
const cbClose = Decoration.line({ class: "cm-cb-line cm-cb-close" });
const cbCode = Decoration.line({ class: "cm-cb-line cm-cb-code" });
const cbCodeNW = Decoration.line({ class: "cm-cb-line cm-cb-code cm-cb-nowrap" });
const fmLine = Decoration.line({ class: "cm-frontmatter" });
const fmFence = Decoration.line({ class: "cm-frontmatter cm-frontmatter-fence" });

function clampedLines(doc: Text, nodeFrom: number, nodeTo: number, from: number, to: number) {
  const blockStart = doc.lineAt(nodeFrom).number;
  const blockEnd = doc.lineAt(nodeTo - 1).number;
  const lo = Math.max(blockStart, doc.lineAt(Math.max(nodeFrom, from)).number);
  const hi = Math.min(blockEnd, doc.lineAt(Math.min(nodeTo - 1, to)).number);
  return { blockStart, blockEnd, lo, hi };
}

/**
 * Whether a FencedCode block actually has a closing fence. While a block is
 * being typed it's unclosed — the parser ends the node at the last content
 * line — so we must NOT treat that line as a footer or exclude it from the box.
 * Inside a fenced block the only all-fence-char line is the closing fence, so a
 * bare ``` / ~~~ on the block's last line means it's closed.
 */
const FENCE_RE = /^(`{3,}|~{3,})\s*$/;
function hasClosingFence(doc: Text, blockStart: number, blockEnd: number): boolean {
  if (blockEnd <= blockStart) return false;
  return FENCE_RE.test(doc.line(blockEnd).text.trimStart());
}

function buildLineDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === "FencedCode") {
          const wrap = effectiveWrap(state, node.from, node.to);
          const { blockStart, blockEnd, lo, hi } = clampedLines(state.doc, node.from, node.to, from, to);
          const closed = hasClosingFence(state.doc, blockStart, blockEnd);
          for (let n = lo; n <= hi; n++) {
            const line = state.doc.line(n);
            if (n === blockStart) {
              builder.add(line.from, line.from, cbOpen);
              builder.add(
                line.to,
                line.to,
                Decoration.widget({
                  widget: new WrapToggleWidget(node.from, node.to, wrap),
                  side: 1,
                }),
              );
            } else if (n === blockEnd && closed) {
              builder.add(line.from, line.from, cbClose);
            } else {
              builder.add(line.from, line.from, wrap ? cbCode : cbCodeNW);
            }
          }
        } else if (node.name === "Frontmatter") {
          const { lo, hi } = clampedLines(state.doc, node.from, node.to, from, to);
          for (let n = lo; n <= hi; n++) {
            const line = state.doc.line(n);
            const t = line.text.trim();
            builder.add(line.from, line.from, t === "---" || t === "..." ? fmFence : fmLine);
          }
        }
      },
    });
  }
  return builder.finish();
}

const fieldChanged = (u: ViewUpdate) =>
  u.startState.field(wrapOverrides, false) !== u.state.field(wrapOverrides, false);

const blockLineDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLineDecos(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.facet(codeBlockWrap) !== u.state.facet(codeBlockWrap) ||
        fieldChanged(u) ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = buildLineDecos(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------
// Block wrapper: one DOM box around a code block's CONTENT lines (fences stay
// outside, as full-width header/footer bars). Gives one horizontal scrollbar
// per block in no-wrap mode.
// ---------------------------------------------------------------------------
const cbBox = BlockWrapper.create({ tagName: "div", attributes: { class: "cm-cb-box" } });
const cbBoxNoWrap = BlockWrapper.create({
  tagName: "div",
  attributes: { class: "cm-cb-box cm-cb-box-nowrap" },
});

function buildBlockWrappers(view: EditorView): RangeSet<BlockWrapper> {
  const { state } = view;
  const ranges: Range<BlockWrapper>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const startLine = state.doc.lineAt(node.from).number;
      const endLine = state.doc.lineAt(node.to - 1).number;
      // Content is the lines between the fences. For an unclosed (mid-typing)
      // block there is no closing fence, so the last line IS content.
      const closed = hasClosingFence(state.doc, startLine, endLine);
      const contentStart = startLine + 1;
      const contentEnd = closed ? endLine - 1 : endLine;
      if (contentStart > contentEnd) return; // no content lines to box
      const contentFrom = state.doc.line(contentStart).from;
      // End at the last content line's end, NOT the closing fence's start:
      // BlockWrapper includes a line that begins exactly at `to`, so ending at
      // the fence start would pull the footer into the scroll box.
      const contentTo = state.doc.line(contentEnd).to;
      if (contentFrom >= contentTo) return;
      const box = effectiveWrap(state, node.from, node.to) ? cbBox : cbBoxNoWrap;
      ranges.push(box.range(contentFrom, contentTo));
    },
  });
  return BlockWrapper.set(ranges, true);
}

// ---------------------------------------------------------------------------
// Keep the cursor/selection head visible inside a no-wrap code box by scrolling
// the box horizontally (CM only scrolls the outer editor, not the nested box).
// ---------------------------------------------------------------------------
const revealCursorInCodeBox = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      if (!u.selectionSet && !u.docChanged) return;
      const view = u.view;
      /* v8 ignore start -- runs only inside CM's measure phase (requestMeasure),
         which needs real layout (coordsAtPos / getBoundingClientRect / scrollLeft)
         that happy-dom does not provide; exercised in the real WebView only. */
      view.requestMeasure({
        read: () => {
          const head = view.state.selection.main.head;
          const coords = view.coordsAtPos(head);
          if (!coords) return null;
          const node = view.domAtPos(head).node;
          const el = (node.nodeType === 3 ? node.parentElement : node) as HTMLElement | null;
          const box = el?.closest(".cm-cb-box") as HTMLElement | null;
          if (!box) return null;
          const r = box.getBoundingClientRect();
          const margin = 28;
          let delta = 0;
          if (coords.right > r.right - margin) delta = coords.right - (r.right - margin);
          else if (coords.left < r.left + margin) delta = coords.left - (r.left + margin);
          return delta ? { box, delta } : null;
        },
        write: (res) => {
          if (res) res.box.scrollLeft += res.delta;
        },
      });
      /* v8 ignore stop */
    }
  },
);

/**
 * The CodeMirror 6 extension set for the editor: GFM markdown parsing with
 * frontmatter, a dark theme, soft-wrapped prose, fenced-code-block cards
 * (full-width header/footer, per-block + editor-wide wrap control, one
 * scrollbar per block), undo history, and the default editing keymap. Native
 * selection is used (no drawSelection) so selection paints over code-block
 * backgrounds.
 */
export function editorExtensions(
  initialCodeWrap = true,
  initialRenderMode: RenderMode = "clean",
  initialIndent: IndentConfig = { style: "spaces", width: 2 },
): Extension[] {
  return [
    history(),
    EditorView.lineWrapping,
    // addKeymap: false — the markdown keymap is re-added at high precedence in
    // editingKeymap (keymap.ts) so its Enter-continuation beats the default
    // keymap. If you remove editingKeymap, re-enable addKeymap here.
    markdown({ base: markdownLanguage, extensions: [GFM, Frontmatter], addKeymap: false }),
    indentExtension(initialIndent),
    codeWrapCompartment.of(codeBlockWrap.of(initialCodeWrap)),
    renderModeCompartment.of(renderMode.of(initialRenderMode)),
    cleanModeContentAttr,
    wrapOverrides,
    blockLineDecorations,
    blockConstructDecorations,
    hrDecorations,
    hrAtomicRanges,
    taskDecorations,
    taskAtomicRanges,
    imageDecorations,
    imageAtomicRanges,
    // Highest decoration precedence so the marker span is the INNERMOST DOM node
    // (CM nests higher-precedence decorations inside) — its absolute font-size
    // then wins over a heading's enclosing 1.9em span instead of compounding.
    Prec.highest(markerDecorations),
    markerAtomicRanges,
    revealCursorInCodeBox,
    EditorView.blockWrappers.of((view) => buildBlockWrappers(view)),
    baseTheme,
    markdownHighlight,
    // B/I toggle, render-mode cycle, soft-tab indent — high precedence, above the
    // default keymap. Markdown Enter/Backspace continuation stays active via
    // lang-markdown's default keymap.
    editingKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap]),
  ];
}
