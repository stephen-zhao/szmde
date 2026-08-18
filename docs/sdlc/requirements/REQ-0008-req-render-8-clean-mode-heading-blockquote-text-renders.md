---
id: REQ-0008
title: REQ-RENDER-8 — Clean-mode heading/blockquote text renders flush by hanging the…
status: approved
opened: 2026-08-17
area: RENDER
spec_section: §4.1
test_type: integration (DOM)
---
Clean-mode heading/blockquote text renders flush by hanging the marker prefix in the gutter via per-line text-indent (transparent off-caret-line, grey on reveal, no reflow); block markers are in-flow/non-atomic while inline markers stay hidden/atomic.

**Tests:** markers.dom.test.ts  (integration (DOM))

_Note:_ Achieved via the per-line text-indent of REQ-RENDER-9; painted transparent (cm-md-mark-invisible) off the caret line.
