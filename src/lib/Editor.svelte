<script module lang="ts">
  import type { WrapState } from "./editor/setup";

  /** Imperative handle the page uses to drive the editor. */
  export interface EditorApi {
    setContent(text: string): void;
    getContent(): string;
    focus(): void;
    /** Set the editor-wide wrap default and clear per-block overrides. */
    setCodeWrap(wrap: boolean): void;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { editorExtensions, setGlobalWrap, wrapStateOf } from "./editor/setup";

  let {
    onchange,
    onready,
    onwrapstate,
  }: {
    onchange?: (value: string) => void;
    onready?: (api: EditorApi) => void;
    onwrapstate?: (state: WrapState) => void;
  } = $props();

  let container: HTMLDivElement;
  let view: EditorView | undefined;
  let codeWrap = true; // editor-wide default; preserved across document loads
  let lastWrapState: WrapState | "" = "";

  function buildState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        ...editorExtensions(codeWrap),
        EditorView.updateListener.of((u) => {
          // Only real user transactions mark the document dirty; a setState
          // document load produces no transactions.
          if (u.docChanged && u.transactions.length) onchange?.(u.state.doc.toString());
          const ws = wrapStateOf(u.state);
          if (ws !== lastWrapState) {
            lastWrapState = ws;
            onwrapstate?.(ws);
          }
        }),
      ],
    });
  }

  function setContent(text: string) {
    if (!view) return;
    // Full state replacement resets undo history (so Ctrl+Z can't wipe a
    // freshly-opened file) and per-block wrap overrides (which are per-document).
    view.setState(buildState(text));
    lastWrapState = "";
    onwrapstate?.(wrapStateOf(view.state));
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

  onMount(() => {
    view = new EditorView({ state: buildState(""), parent: container });
    view.focus();
    onready?.({ setContent, getContent, focus, setCodeWrap });
    onwrapstate?.(wrapStateOf(view.state));
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
