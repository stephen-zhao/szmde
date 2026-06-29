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
      // Always reserve the vertical scrollbar's space on BOTH edges so that the
      // centered reading column (.cm-content margin:0 auto) keeps an identical,
      // symmetric position whether or not the document overflows. Without this,
      // the scrollbar appearing steals width from the right and the column
      // recenters a few px leftward (a visible jump while typing).
      scrollbarGutter: "stable both-edges",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      fontSize: "var(--editor-font-size)",
      // REQ-RENDER-12 / REQ-ZOOM-4 — three columns: [fold chevron][marker gutter]
      // [content]. The left two are reserved as padding so the chevron and the
      // Syntax-mode hung markers live in their OWN lanes (no more overlap) and stay
      // inside the reading column (never clipped off the left edge, even when the
      // page width is maxed to the window). Sized off --editor-font-size so they
      // scale with zoom; the gutter fits up to `######`'s small-grey prefix.
      "--fold-col": "calc(var(--editor-font-size) * 1.7)",
      "--marker-gutter": "calc(var(--editor-font-size) * 3.2)",
      // Reading-column width is driven by appearance.lineWidth (settings §8) via
      // --reading-width (px); falls back to 740px before settings load / on the
      // web. This is a max-width on an auto-width, margin-auto-centered block under
      // the global `box-sizing: border-box` (app.css), so the column already does
      // exactly REQ-ZOOM-3: it grows up to --reading-width and centers; when the
      // window shrinks below that, auto width fills the container so the column
      // CLINGS to the window width (padding included, no overflow), then grows back
      // out as the window widens. border-box counts ALL the padding (incl. the two
      // reserved columns) inside --reading-width, so the max page width (window
      // width) keeps all three columns on-screen (REQ-ZOOM-4).
      maxWidth: "var(--reading-width, 740px)",
      margin: "0 auto",
      paddingTop: "72px",
      paddingRight: "28px",
      paddingBottom: "40vh",
      paddingLeft: "calc(28px + var(--fold-col) + var(--marker-gutter))",
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
    // This also styles the gutter-hung block-marker PREFIX (`#…`/`>`(s) + spaces),
    // which is shifted into the marker-gutter column by the line's text-indent
    // (RENDER-9/10/12, set in markers.ts) — the caret follows because text-indent
    // moves the line's inline origin, not just the glyph. `white-space:pre` keeps
    // the prefix's spaces (the measured gap that text flushes against).
    ".cm-md-mark-syntax": {
      color: "var(--faint)",
      fontWeight: "normal",
      fontStyle: "normal",
      fontSize: "calc(var(--editor-font-size) * 0.75)",
      verticalAlign: "baseline",
      whiteSpace: "pre",
    },
    // Clean mode, block marker OFF the caret line: same hung prefix as cm-md-mark-
    // syntax (so the slot/width is identical) but painted transparent, so revealing
    // it (drop this class → grey) changes only colour and the content never reflows.
    ".cm-md-mark-invisible": { color: "transparent" },
    // markers-syntax: a list marker (bullet dash / ordered number) is content, not
    // pure syntax, so it shows its literal in normal text style — not small-grey.
    ".cm-md-list-marker": { color: "var(--text)" },
    // markers-rendered: marker styled identically to the text it formats.
    ".cm-mk-strong": { fontWeight: "700" },
    ".cm-mk-em": { fontStyle: "italic" },
    ".cm-mk-strike": { textDecoration: "line-through" },
    ".cm-mk-code": { fontFamily: "var(--font-mono)", color: "var(--code)" },
    // Clean mode: list markers are real content, not syntax — normal text color.
    ".cm-md-bullet": { color: "var(--text)" },
    ".cm-md-list-number": { color: "var(--text)" },
    // Hang-indent: an invisible clone of the marker prefix on a continuation
    // line. visibility:hidden keeps its layout width (so text aligns under the
    // item content) while drawing nothing; white-space:pre preserves the spaces.
    ".cm-md-hang-indent": { visibility: "hidden", whiteSpace: "pre" },

    // --- Block constructs (headings / blockquote) ---------------------------
    // Heading size/weight come from the highlight tag; these add vertical
    // breathing room. Padding (measured by CM), never margin (cursor alignment).
    // A foldable heading line (cm-foldhead, set by fold.ts on ATX AND setext lines)
    // is position:relative so it's the containing block for its absolutely-positioned
    // fold chevron (column A) — without it the chevron would anchor to the scroller.
    ".cm-foldhead": { position: "relative" },
    ".cm-h1, .cm-h2": { paddingTop: "0.45em" },
    ".cm-h3, .cm-h4, .cm-h5, .cm-h6": { paddingTop: "0.3em" },
    // Blockquote: a left bar; consecutive quote lines stack into one continuous
    // bar. Border + padding shift horizontally only.
    ".cm-blockquote": {
      borderLeft: "3px solid var(--border)",
      paddingLeft: "14px",
    },
    // GFM alerts / callouts: a colored left bar + faint tint per type. Each line
    // carries the class (continuous bar like the blockquote); per-type accent +
    // tint come from CSS custom properties set by the type modifier class.
    ".cm-alert": {
      borderLeft: "3px solid var(--alert-accent, var(--border))",
      paddingLeft: "14px",
      backgroundColor: "var(--alert-tint, transparent)",
    },
    ".cm-alert-title": { paddingTop: "0.2em" },
    ".cm-alert-note": { "--alert-accent": "#4493f8", "--alert-tint": "rgba(68,147,248,0.08)" },
    ".cm-alert-tip": { "--alert-accent": "#3fb950", "--alert-tint": "rgba(63,185,80,0.08)" },
    ".cm-alert-important": { "--alert-accent": "#ab7df8", "--alert-tint": "rgba(171,125,248,0.08)" },
    ".cm-alert-warning": { "--alert-accent": "#d29922", "--alert-tint": "rgba(210,153,34,0.09)" },
    ".cm-alert-caution": { "--alert-accent": "#f85149", "--alert-tint": "rgba(248,81,73,0.08)" },
    // The icon + name shown in Clean mode in place of `[!TYPE]`.
    ".cm-alert-label": {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.4em",
      fontWeight: "700",
      color: "var(--alert-accent)",
    },
    ".cm-alert-icon": { fontWeight: "700" },
    ".cm-alert-label-note .cm-alert-icon::before": { content: '"ⓘ"' },
    ".cm-alert-label-tip .cm-alert-icon::before": { content: '"✦"' },
    ".cm-alert-label-important .cm-alert-icon::before": { content: '"❖"' },
    ".cm-alert-label-warning .cm-alert-icon::before": { content: '"△"' },
    ".cm-alert-label-caution .cm-alert-icon::before": { content: '"⊘"' },
    // GFM table (Clean mode): the pipe source is replaced by this real <table>.
    // Block widget, so it carries its own spacing; collapse borders for crisp
    // grid lines and tint the header row.
    ".cm-md-table": {
      borderCollapse: "collapse",
      margin: "0.4em 0",
      fontSize: "0.95em",
      lineHeight: "1.5",
    },
    ".cm-md-table th, .cm-md-table td": {
      border: "1px solid var(--border)",
      padding: "5px 12px",
      textAlign: "left",
    },
    ".cm-md-table th": {
      backgroundColor: "var(--code-header-bg)",
      fontWeight: "700",
    },
    // Inline image (Clean mode): replaces `![alt](src)`. Constrain to the reading
    // column width and keep aspect ratio; rounded to match the code-card style.
    ".cm-md-image": {
      display: "inline-block",
      maxWidth: "100%",
      height: "auto",
      borderRadius: "6px",
      verticalAlign: "bottom",
    },
    // Emoji shortcode glyph (Clean mode): replaces `:smile:`. Normal weight/style
    // so it isn't italicized/bolded inside emphasis; sits on the text baseline.
    ".cm-md-emoji": {
      fontStyle: "normal",
      fontWeight: "normal",
      lineHeight: "1",
    },
    // An emoji widget sits OUTSIDE the heading-size highlight mark, so scale it to
    // the enclosing heading (mirrors the markdownHighlight heading sizes) — else
    // it renders tiny next to big heading text.
    ".cm-h1 .cm-md-emoji": { fontSize: "1.9em" },
    ".cm-h2 .cm-md-emoji": { fontSize: "1.55em" },
    ".cm-h3 .cm-md-emoji": { fontSize: "1.3em" },
    // Task-list checkbox (Clean mode): replaces the `[ ]`/`[x]` marker. Accent
    // color matches the editor accent; sits on the text baseline.
    ".cm-md-task": {
      cursor: "pointer",
      margin: "0 0.15em 0 0",
      verticalAlign: "middle",
      accentColor: "var(--accent)",
    },
    // Horizontal rule (Clean mode): the `---` line is replaced by this block
    // divider. A full-height flex band (em-based so it scales with the font)
    // makes the WHOLE line clickable — not just a thin strip — so a click always
    // lands on the widget (which drops the caret at the line end), and the rule
    // is drawn centered via the flex-filling ::after.
    ".cm-md-hr": {
      display: "flex",
      alignItems: "center",
      height: "1.6em",
      cursor: "pointer",
    },
    ".cm-md-hr::after": {
      content: '""',
      flex: "1",
      borderTop: "2px solid var(--border)",
    },

    // --- Find & replace panel (@codemirror/search, REQ-FR-1) ----------------
    ".cm-panels": { backgroundColor: "var(--bg-raised)", color: "var(--text)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
    // REQ-FR-3: every text element in the panel shares ONE size — pinned to ~0.85
    // of the editor font so it tracks zoom and never reads as tiny next to
    // scaled-up body text. CM creates its search inputs as `<input
    // class="cm-textfield">` with NO `type` attribute, so an `input[type=text]`
    // selector MISSES them and they keep CM's default `.cm-textfield`
    // `font-size:70%` (the bug: inputs smaller than buttons smaller-than... ). We
    // therefore target the real classes and force inputs + buttons + checkbox
    // labels + the close button all to `inherit`, so all three read identically.
    ".cm-search": {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "7px",
      padding: "9px 11px",
      fontSize: "calc(var(--editor-font-size, 16px) * 0.85)",
    },
    ".cm-search .cm-textfield, .cm-search .cm-button, .cm-search button": {
      fontSize: "inherit",
    },
    // CM's search baseTheme sets `& label { font-size: 80% }`, which shrinks the
    // checkbox labels below everything else. The panel div carries BOTH .cm-search
    // and .cm-panel, so this two-class selector out-ranks it → labels match.
    ".cm-search.cm-panel label": { fontSize: "inherit" },
    ".cm-search .cm-textfield": {
      background: "var(--bg)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      padding: "4px 9px",
      minWidth: "18ch",
    },
    ".cm-search .cm-textfield:focus": { outline: "none", borderColor: "var(--accent)" },
    ".cm-search .cm-button": {
      backgroundImage: "none",
      background: "var(--bg-raised)",
      color: "var(--muted)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      padding: "4px 10px",
      cursor: "pointer",
    },
    ".cm-search .cm-button:hover": { color: "var(--text)", borderColor: "var(--accent)" },
    ".cm-search label": {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      color: "var(--muted)",
    },
    ".cm-search [name=close]": { color: "var(--muted)", cursor: "pointer", padding: "0 4px" },
    ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)" },
    ".cm-searchMatch-selected": {
      backgroundColor: "color-mix(in srgb, var(--accent) 55%, transparent)",
    },

    // --- Folding (REQ-FOLD-1) -----------------------------------------------
    // A foldable heading's fold control, rendered as a real button chip (border +
    // raised fill) so it's clearly clickable and prominent in every render mode
    // (no CM gutter → the centered reading column is preserved). REQ-RENDER-12: it
    // lives in its OWN column (A), absolutely positioned just left of the marker
    // gutter (B). Being out of the inline flow, it is NOT moved by the heading
    // line's text-indent (which hangs the markers), so its lane is fixed regardless
    // of heading depth — it never collides with a deep heading's `######` (the old
    // negative-margin chevron did). The heading line is position:relative (below)
    // so `left` is measured from the content edge; `left` reaches back across the
    // gutter into column A. Font-size pinned to the body size (NOT the heading em).
    ".cm-fold-chevron": {
      position: "absolute",
      left: "calc(-1 * (var(--marker-gutter) + var(--fold-col)))",
      top: "0.55em",
      // text-indent is inherited; the heading line carries a negative text-indent
      // (the gutter hang, RENDER-9), which would otherwise drag the arrow GLYPH left
      // out of the button (the absolutely-positioned box ignores it, the inline glyph
      // doesn't). Reset it so the glyph centres in the chip at every heading depth.
      textIndent: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
      width: "1.45em",
      height: "1.45em",
      border: "1px solid var(--border)",
      borderRadius: "5px",
      color: "var(--muted)",
      backgroundColor: "var(--bg-raised)",
      cursor: "pointer",
      userSelect: "none",
      fontSize: "calc(var(--editor-font-size) * 0.82)",
      lineHeight: "1",
    },
    ".cm-fold-chevron:hover": {
      color: "var(--text)",
      borderColor: "var(--accent)",
      backgroundColor: "var(--bg)",
    },
    // The "⋯" shown in place of a folded section.
    ".cm-foldPlaceholder": {
      margin: "0 0.4em",
      padding: "0 0.4em",
      border: "1px solid var(--border)",
      borderRadius: "5px",
      color: "var(--muted)",
      backgroundColor: "var(--bg-raised)",
      cursor: "pointer",
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
