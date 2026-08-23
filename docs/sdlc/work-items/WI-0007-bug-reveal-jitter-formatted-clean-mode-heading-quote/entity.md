---
id: WI-0007
title: BUG-REVEAL-JITTER — Formatted/Clean mode heading/quote content twitched sub-pixel…
status: done
relations:
  implements:
    - REQ-0008
    - REQ-0068
  parent: EPIC-0005
opened: 2026-08-17
---
In Formatted/Clean mode the whole heading/quote content twitched by a sub-pixel on every caret on/off-line, because revealing a marker changed the layout (hidden = marker removed + no indent; revealed = marker shown + text-indent), and the canvas-measured indent W can't be pixel-identical to the rendered prefix width A (delta = A-W).

**Fix:** In Clean mode block markers now always hang in the gutter in flow; revealing flips only their colour (transparent cm-md-mark-invisible -> grey cm-md-mark-syntax), so layout is identical in both states and content never moves (the A-W offset becomes a constant static nudge, not per-reveal jitter). Trade-off: Clean-mode block markers are now in-flow/non-atomic. Confirmed in WebView2 (M4 shipped & merged).

**Violates:** REQ-RENDER-8, REQ-RENDER-11
