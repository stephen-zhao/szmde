---
id: WI-0008
title: BUG-CARET-MARGIN — Native caret rendered at the left margin instead of in the…
status: done
relations:
  implements:
    - REQ-0067
  parent: EPIC-0005
opened: 2026-08-17
---
The native caret rendered at the left margin instead of in the gutter, just before a hung block marker (rendering only; document flow was already correct). Root cause: the caret for 'before #' attaches to the line's inline-content origin, but the negative-margin hang moved only the marker glyph, leaving the origin at the margin. Engine-dependent (WebView2 drew it at the margin); a CM-drawn cursor did not help.

**Fix:** Replaced the per-marker negative margin with a per-LINE text-indent equal to the marker prefix's measured width, so text-indent shifts the inline origin itself and the native caret follows the glyph into the gutter in every engine. Re-architected the left edge into 3 columns [chevron][marker gutter][content] (REQ-RENDER-12). Re-measured on font load/size change. Verified live (WF-24). Confirmed in WebView2 (M4 shipped & merged).

**Violates:** REQ-RENDER-9
