---
id: REQ-0067
title: 'REQ-RENDER-9 — Syntax mode (and Formatted reveal): a block marker''s whole leading…'
status: approved
opened: 2026-08-17
area: RENDER
spec_section: §4.1
test_type: integration (DOM)
---
Syntax mode (and Formatted reveal): a block marker's whole leading prefix hangs in the left marker-gutter via a per-line text-indent (negative, canvas-measured, baked into a line Decoration) plus a small-grey mark, keeping heading/quote text flush while chars stay real/editable/selectable; native caret follows the glyph into the gutter in every engine.

**Tests:** editor/markers.dom.test.ts  (integration (DOM))
**Live workflows:** WF-24

_Note:_ text-indent (not per-marker negative margin) is the caret-fix crux — a negative margin stranded the caret at the margin in WebView2; one indent per line even for nested > >/> #; no hang in Source; re-measured on font change (remeasureOnFontChange); live gutter/flush/glide/caret-in-gutter → WF-24.
