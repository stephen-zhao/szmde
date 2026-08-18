# Plan

- [x] Replaced the per-marker negative margin with a per-LINE text-indent equal to the marker prefix's measured width, so text-indent shifts the inline origin itself and the native caret follows the glyph into the gutter in every engine. Re-architected the left edge into 3 columns [chevron][marker gutter][content] (REQ-RENDER-12). Re-measured on font load/size change. Verified live (WF-24). Confirmed in WebView2 (M4 shipped & merged).
