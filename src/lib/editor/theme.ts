import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Base CodeMirror theme for szmde. The editor is a centered reading column on a
 * dark canvas (SPEC §7). Selection is the browser-native `::selection` (no
 * drawSelection) so it paints over code-block backgrounds.
 *
 * IMPORTANT (cursor alignment): CodeMirror's height map measures `.cm-line`
 * border-boxes. Padding on a line IS measured; margins (on lines OR on the
 * block-wrapper box) are NOT, and any unmeasured vertical space makes mouse
 * clicks map to the wrong line. So: no margins anywhere in code-block layout —
 * all spacing is line padding, and the wrapper box carries only paint
 * (background / radius / overflow), never box-model size.
 */
export const baseTheme = EditorView.theme(
  {
    "&": {
      color: "var(--text)",
      backgroundColor: "var(--bg)",
      height: "100%",
    },
    ".cm-scroller": {
      overflow: "auto",
      lineHeight: "1.7",
      fontFamily: "var(--font-body)",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      fontSize: "var(--editor-font-size)",
      maxWidth: "740px",
      margin: "0 auto",
      padding: "72px 28px 40vh",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-content ::selection": { backgroundColor: "var(--selection)" },
    ".cm-gutters": { display: "none" },

    // --- Fenced code blocks --------------------------------------------------
    // The wrapper box (.cm-cb-box) wraps only the CONTENT lines and is the
    // single horizontal scroll container in no-wrap mode. Paint only — no
    // margin/border/padding (those would desync CM's height map).
    ".cm-cb-box": {
      backgroundColor: "var(--code-bg)",
    },
    ".cm-cb-box-nowrap": {
      overflowX: "auto",
      overflowY: "hidden",
    },
    ".cm-cb-line": {
      fontFamily: "var(--font-mono)",
      fontSize: "0.9em",
      padding: "0 14px",
    },
    // Opening ```lang and closing ``` are full-width header / footer bars,
    // rendered OUTSIDE the scroll box so they always span the visible width.
    ".cm-cb-open, .cm-cb-close": {
      position: "relative",
      color: "var(--muted)",
      backgroundColor: "var(--code-header-bg)",
      fontSize: "0.8em",
    },
    ".cm-cb-open": {
      paddingTop: "8px",
      paddingBottom: "4px",
      borderTopLeftRadius: "8px",
      borderTopRightRadius: "8px",
      borderBottom: "1px solid var(--code-border)",
    },
    ".cm-cb-close": {
      paddingTop: "4px",
      paddingBottom: "8px",
      borderBottomLeftRadius: "8px",
      borderBottomRightRadius: "8px",
      borderTop: "1px solid var(--code-border)",
    },
    // Wrapped code: hanging indent so a soft-wrapped continuation row is offset
    // from a real new line (the wrap indicator).
    ".cm-cb-code:not(.cm-cb-nowrap)": {
      paddingLeft: "2.6em",
      textIndent: "-1.4em",
    },
    // No-wrap code: keep lines intact; the .cm-cb-box scrolls horizontally.
    ".cm-cb-nowrap": {
      whiteSpace: "pre",
    },
    // Per-block wrap toggle, absolutely positioned in the header (out of flow,
    // so it never affects line measurement).
    ".cm-cb-wraptoggle": {
      position: "absolute",
      top: "6px",
      right: "12px",
      padding: "1px 7px",
      borderRadius: "5px",
      border: "1px solid var(--code-border)",
      color: "var(--muted)",
      backgroundColor: "var(--bg)",
      fontSize: "0.92em",
      fontFamily: "var(--font-body)",
      cursor: "pointer",
      userSelect: "none",
    },
    ".cm-cb-wraptoggle:hover": {
      color: "var(--text)",
      borderColor: "var(--accent)",
    },

    // --- Frontmatter (preamble) ---------------------------------------------
    ".cm-frontmatter": {
      color: "var(--muted)",
      fontFamily: "var(--font-mono)",
      fontSize: "0.85em",
      backgroundColor: "var(--code-bg)",
      borderLeft: "2px solid var(--border)",
      paddingLeft: "12px",
    },
    ".cm-frontmatter-fence": {
      color: "var(--faint)",
    },

    // --- Markdown markers (render modes, SPEC §4.1) --------------------------
    // markers-syntax: small greyed token. Absolute size (≈0.75 of the base
    // paragraph font) so a heading's marker is the SAME small size as a
    // paragraph's, not enlarged by the inherited heading font-size. Explicit
    // weight/style override inherited bold/italic so it reads as a syntax token.
    ".cm-md-mark-syntax": {
      color: "var(--faint)",
      fontWeight: "normal",
      fontStyle: "normal",
      fontSize: "calc(var(--editor-font-size) * 0.75)",
      verticalAlign: "baseline",
    },
    // markers-rendered: marker styled identically to the text it formats.
    ".cm-mk-strong": { fontWeight: "700" },
    ".cm-mk-em": { fontStyle: "italic" },
    ".cm-mk-strike": { textDecoration: "line-through" },
    ".cm-mk-code": { fontFamily: "var(--font-mono)", color: "var(--code)" },
    // Clean mode: list markers are real content, not syntax — normal text color.
    ".cm-md-bullet": { color: "var(--text)" },
    ".cm-md-list-number": { color: "var(--text)" },

    // --- Block constructs (headings / blockquote) ---------------------------
    // Heading size/weight come from the highlight tag; these add vertical
    // breathing room. Padding (measured by CM), never margin (cursor alignment).
    ".cm-h1, .cm-h2": { paddingTop: "0.45em" },
    ".cm-h3, .cm-h4, .cm-h5, .cm-h6": { paddingTop: "0.3em" },
    // Blockquote: a left bar; consecutive quote lines stack into one continuous
    // bar. Border + padding shift horizontally only.
    ".cm-blockquote": {
      borderLeft: "3px solid var(--border)",
      paddingLeft: "14px",
    },
  },
  { dark: true },
);

/** Markdown emphasis: headings render larger, bold/italic styled, code monospaced. */
export const markdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading1, fontSize: "1.9em", fontWeight: "700", lineHeight: "1.3" },
    { tag: t.heading2, fontSize: "1.55em", fontWeight: "700", lineHeight: "1.3" },
    { tag: t.heading3, fontSize: "1.3em", fontWeight: "600" },
    { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
    { tag: t.url, color: "var(--muted)" },
    { tag: [t.monospace], fontFamily: "var(--font-mono)", color: "var(--code)" },
    { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
    { tag: t.list, color: "var(--text)" },
    { tag: [t.processingInstruction, t.meta], color: "var(--muted)" },
  ]),
);
