<script module lang="ts">
  import type { WrapState } from "./editor/setup";
  import type { RenderMode } from "./editor/render-mode";

  /** Imperative handle the page uses to drive the editor. */
  export interface EditorApi {
    setContent(text: string): void;
    getContent(): string;
    focus(): void;
    /** Set the editor-wide wrap default and clear per-block overrides. */
    setCodeWrap(wrap: boolean): void;
    /** Set the WYSIWYG render mode (clean / markers-rendered / markers-syntax). */
    setRenderMode(mode: RenderMode): void;
    getRenderMode(): RenderMode;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { editorExtensions, setGlobalWrap, wrapStateOf } from "./editor/setup";
  import { renderModeOf, setRenderMode as applyRenderMode } from "./editor/render-mode";

  let {
    onchange,
    onready,
    onwrapstate,
    onrendermode,
  }: {
    onchange?: (value: string) => void;
    onready?: (api: EditorApi) => void;
    onwrapstate?: (state: WrapState) => void;
    onrendermode?: (mode: RenderMode) => void;
  } = $props();

  let container: HTMLDivElement;
  let view: EditorView | undefined;
  let codeWrap = true; // editor-wide default; preserved across document loads
  let renderMode: RenderMode = "clean"; // editor-wide; preserved across loads
  let lastWrapState: WrapState | "" = "";
  let lastRenderMode: RenderMode | "" = "";

  function buildState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        ...editorExtensions(codeWrap, renderMode),
        EditorView.updateListener.of((u) => {
          // Only real user transactions mark the document dirty; a setState
          // document load produces no transactions.
          if (u.docChanged && u.transactions.length) onchange?.(u.state.doc.toString());
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
    onwrapstate?.(wrapStateOf(view.state));
    onrendermode?.(renderModeOf(view.state));
    view.focus();
  }

  function getContent(): string {
    return view ? view.state.doc.toString() : "";
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

  onMount(() => {
    view = new EditorView({ state: buildState(""), parent: container });
    view.focus();
    onready?.({ setContent, getContent, focus, setCodeWrap, setRenderMode, getRenderMode });
    onwrapstate?.(wrapStateOf(view.state));
    onrendermode?.(renderModeOf(view.state));
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
