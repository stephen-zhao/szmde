# Plan

- [x] In Clean mode block markers now always hang in the gutter in flow; revealing flips only their colour (transparent cm-md-mark-invisible -> grey cm-md-mark-syntax), so layout is identical in both states and content never moves (the A-W offset becomes a constant static nudge, not per-reveal jitter). Trade-off: Clean-mode block markers are now in-flow/non-atomic. Confirmed in WebView2 (M4 shipped & merged).
