import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Facet, RangeSet, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { renderMode } from "./render-mode";

/**
 * How a local/relative image `src` is turned into something the WebView can load.
 * Remote (`http(s):`) and `data:` URLs bypass this and are used verbatim. The
 * desktop app injects Tauri's `convertFileSrc` (resolving against the open file's
 * directory); the default is identity, which is correct for the web build and
 * tests. Provide via `imageResolver.of(fn)` in the extension set.
 */
export type ImageSrcResolver = (src: string) => string;

export const imageResolver = Facet.define<ImageSrcResolver, ImageSrcResolver>({
  combine: (vals) => (vals.length ? vals[0] : (s) => s),
});

const REMOTE = /^(https?:|data:)/i;
function resolveSrc(raw: string, resolve: ImageSrcResolver): string {
  return REMOTE.test(raw) ? raw : resolve(raw);
}

/** An inline image rendered in Clean mode in place of `![alt](src)`. */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM() {
    const el = document.createElement("img");
    el.className = "cm-md-image";
    el.setAttribute("src", this.src);
    el.setAttribute("alt", this.alt);
    if (this.alt) el.setAttribute("title", this.alt);
    el.setAttribute("loading", "lazy");
    return el;
  }
  /* v8 ignore start -- pointer-event plumbing; not dispatchable in happy-dom. */
  ignoreEvent() {
    return true;
  }
  /* v8 ignore stop */
}

const hide = Decoration.replace({});

/** Normalize a link-reference label the way CommonMark does (case/space-fold). */
const normalizeLabel = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Collect `[id]: url` reference definitions from the whole document. */
const REF_DEF = /^[ ]{0,3}\[([^\]\n]+)\]:[ \t]*<?([^>\s]+)>?/gm;
function collectRefs(doc: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const m of doc.matchAll(REF_DEF)) refs.set(normalizeLabel(m[1]), m[2]);
  return refs;
}

interface ImageDecos {
  decorations: DecorationSet;
  hidden: RangeSet<Decoration>;
}

function buildImageDecos(view: EditorView): ImageDecos {
  const decos: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const { state } = view;
  const mode = state.facet(renderMode);
  if (mode !== "clean") return { decorations: Decoration.none, hidden: RangeSet.empty };

  const resolve = state.facet(imageResolver);
  // Reveal-on-cursor: a caret touching the image construct shows the raw source.
  const caretPos: number[] = [];
  for (const sel of state.selection.ranges) {
    caretPos.push(sel.from);
    if (sel.to !== sel.from) caretPos.push(sel.to);
  }

  let refs: Map<string, string> | null = null; // built lazily on first ref image

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Image") return;
        if (caretPos.some((p) => p >= node.from && p <= node.to)) return; // reveal

        const marks = node.node.getChildren("LinkMark");
        const altFrom = node.from + 2; // past "!["
        const altTo = marks[1] ? marks[1].from : node.to; // the closing "]"
        const alt = state.doc.sliceString(altFrom, altTo);

        const urlNode = node.node.getChild("URL");
        let raw: string | undefined;
        if (urlNode) {
          raw = state.doc.sliceString(urlNode.from, urlNode.to);
        } else {
          const labelNode = node.node.getChild("LinkLabel");
          const id = labelNode
            ? state.doc.sliceString(labelNode.from + 1, labelNode.to - 1) // strip [ ]
            : alt; // shortcut form ![label]
          if (!refs) refs = collectRefs(state.doc.toString());
          raw = refs.get(normalizeLabel(id));
        }
        if (!raw) return; // unresolved → leave the literal markdown visible

        const widget = new ImageWidget(resolveSrc(raw, resolve), alt);
        decos.push(Decoration.replace({ widget }).range(node.from, node.to));
        hidden.push(hide.range(node.from, node.to));
      },
    });
  }
  return {
    decorations: Decoration.set(decos, true),
    hidden: RangeSet.of(hidden, true),
  };
}

export const imageDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hidden: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const r = buildImageDecos(view);
      this.decorations = r.decorations;
      this.hidden = r.hidden;
    }
    update(u: ViewUpdate) {
      const cleanNow = u.state.facet(renderMode) === "clean";
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.facet(renderMode) !== u.state.facet(renderMode) ||
        (cleanNow && u.selectionSet) || // reveal-on-cursor rebuild
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        const r = buildImageDecos(u.view);
        this.decorations = r.decorations;
        this.hidden = r.hidden;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Make the Clean-mode image atomic: arrows skip it and one delete removes it. */
export const imageAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.plugin(imageDecorations)?.hidden ?? RangeSet.empty,
);
