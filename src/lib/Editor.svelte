<script module lang="ts">
  import type { WrapState } from "./editor/setup";
  import type { RenderMode } from "./editor/render-mode";
  import type { IndentConfig } from "./editor/indent";
  import type { TextCount } from "./editor/count";

  /** Imperative handle the page uses to drive the editor. */
  export interface EditorApi {
    setContent(text: string): void;
    getContent(): string;
    focus(): void;
    /** Current word/character count of the document (REQ-COUNT-1). */
    getCount(): TextCount;
    /** Set the editor-wide wrap default and clear per-block overrides. */
    setCodeWrap(wrap: boolean): void;
    /** Set the WYSIWYG render mode (clean / markers-rendered / markers-syntax). */
    setRenderMode(mode: RenderMode): void;
    getRenderMode(): RenderMode;
    /** Set the indentation style/width (Spaces ⇄ Tab, width). */
    setIndent(config: IndentConfig): void;
    getIndent(): IndentConfig;
    /** Convert all existing leading whitespace to the current indent style. */
    convertIndentation(): void;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { editorExtensions, setGlobalWrap, wrapStateOf } from "./editor/setup";
  import { countText } from "./editor/count"; // TextCount type comes from the module script above
  import { renderModeOf, setRenderMode as applyRenderMode } from "./editor/render-mode";
  import {
    convertIndentation as applyConvertIndent,
    indentConfigOf,
    setIndent as applyIndent,
  } from "./editor/indent";

  let {
    onchange,
    onready,
    onwrapstate,
    onrendermode,
    onindentstate,
    oncount,
  }: {
    onchange?: (value: string) => void;
    onready?: (api: EditorApi) => void;
    onwrapstate?: (state: WrapState) => void;
    onrendermode?: (mode: RenderMode) => void;
    onindentstate?: (config: IndentConfig) => void;
    oncount?: (count: TextCount) => void;
  } = $props();

  let container: HTMLDivElement;
  let view: EditorView | undefined;
  let codeWrap = true; // editor-wide default; preserved across document loads
  let renderMode: RenderMode = "clean"; // editor-wide; preserved across loads
  let indent: IndentConfig = { style: "spaces", width: 2 }; // editor-wide
  let lastWrapState: WrapState | "" = "";
  let lastRenderMode: RenderMode | "" = "";
  let lastIndentKey = "";
  let lastCountKey = "";

  const indentKey = (c: IndentConfig) => `${c.style}:${c.width}`;

  function buildState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        ...editorExtensions(codeWrap, renderMode, indent),
        EditorView.updateListener.of((u) => {
          // Only real user transactions mark the document dirty; a setState
          // document load produces no transactions.
          if (u.docChanged && u.transactions.length) onchange?.(u.state.doc.toString());
          // Recompute the count only when the document changed (selection-only
          // updates skip it — the cheapness lever), and only fire on a real change.
          if (u.docChanged) {
            const c = countText(u.state.doc.toString());
            const key = `${c.words}:${c.chars}`;
            if (key !== lastCountKey) {
              lastCountKey = key;
              oncount?.(c);
            }
          }
          const ws = wrapStateOf(u.state);
          if (ws !== lastWrapState) {
            lastWrapState = ws;
            onwrapstate?.(ws);
          }
          const rm = renderModeOf(u.state);
          if (rm !== lastRenderMode) {
            lastRenderMode = rm;
            renderMode = rm;
            onrendermode?.(rm);
          }
          const ic = indentConfigOf(u.state);
          if (indentKey(ic) !== lastIndentKey) {
            lastIndentKey = indentKey(ic);
            indent = ic;
            onindentstate?.(ic);
          }
        }),
      ],
    });
  }

  function setContent(text: string) {
    if (!view) return;
    // Full state replacement resets undo history (so Ctrl+Z can't wipe a
    // freshly-opened file) and per-block wrap overrides (which are per-document).
    // renderMode/codeWrap are editor-wide and re-seeded via buildState.
    view.setState(buildState(text));
    lastWrapState = "";
    lastRenderMode = "";
    lastIndentKey = "";
    lastCountKey = "";
    onwrapstate?.(wrapStateOf(view.state));
    onrendermode?.(renderModeOf(view.state));
    onindentstate?.(indentConfigOf(view.state));
    oncount?.(countText(view.state.doc.toString()));
    view.focus();
  }

  function getContent(): string {
    return view ? view.state.doc.toString() : "";
  }

  function getCount(): TextCount {
    return view ? countText(view.state.doc.toString()) : { words: 0, chars: 0 };
  }

  function focus() {
    view?.focus();
  }

  function setCodeWrap(wrap: boolean) {
    codeWrap = wrap;
    if (view) setGlobalWrap(view, wrap);
  }

  function setRenderMode(mode: RenderMode) {
    renderMode = mode;
    if (view) applyRenderMode(view, mode);
  }

  function getRenderMode(): RenderMode {
    return view ? renderModeOf(view.state) : renderMode;
  }

  function setIndent(config: IndentConfig) {
    indent = config;
    if (view) applyIndent(view, config);
  }

  function getIndent(): IndentConfig {
    return view ? indentConfigOf(view.state) : indent;
  }

  function convertIndentation() {
    if (view) applyConvertIndent(view);
  }

  onMount(() => {
    view = new EditorView({ state: buildState(""), parent: container });
    view.focus();
    // Dev-only debug handle so the preview harness can drive/inspect the editor.
    if (import.meta.env.DEV) (window as unknown as { __cmview: EditorView }).__cmview = view;
    onready?.({
      setContent,
      getContent,
      getCount,
      focus,
      setCodeWrap,
      setRenderMode,
      getRenderMode,
      setIndent,
      getIndent,
      convertIndentation,
    });
    onwrapstate?.(wrapStateOf(view.state));
    onrendermode?.(renderModeOf(view.state));
    onindentstate?.(indentConfigOf(view.state));
    oncount?.(countText(view.state.doc.toString()));
  });

  onDestroy(() => view?.destroy());
</script>

<div class="editor" bind:this={container}></div>

<style>
  .editor {
    height: 100%;
    width: 100%;
  }
  .editor :global(.cm-editor) {
    height: 100%;
  }
</style>
