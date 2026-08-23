---
id: REQ-0066
title: 'REQ-SCROLL-1 — Typewriter scrolling: the active line never rests below a…'
status: approved
opened: 2026-08-17
area: SCROLL
spec_section: §4.5
test_type: unit + integration (DOM)
---
Typewriter scrolling: the active line never rests below a two-thirds-down anchor (editor.typewriterAnchor default 2/3); implemented as an EditorView.scrollHandler that always returns false and schedules a measure-phase requestMeasure using coordsAtPos, one-directional by design, on by default.

**Tests:** editor/typewriter.test.ts, editor/typewriter.dom.test.ts, settings/schema.test.ts  (unit + integration (DOM))
**Live workflows:** WF-31

_Note:_ Rejected designs recorded with evidence (scrollMargins facet; height-map geometry). coordsAtPos only legal in measure phase (throws readMeasured in the handler). Tracks window resize, REQ-ZOOM changes, and the Android soft keyboard 952→579 (--kb-inset, M6 S3); near doc-end the 40vh bottom padding runs out so last lines rest above the anchor (measured, not a defect). Live feel → WF-31.
