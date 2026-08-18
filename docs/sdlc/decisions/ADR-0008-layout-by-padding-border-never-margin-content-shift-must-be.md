---
id: ADR-0008
title: Layout by padding/border, never margin; content shift must be genuine…
status: accepted
opened: 2026-08-17
---
**Choice:** Use padding/border, never margin; keep the symmetric centered reading column; the left edge is a 3-column [fold chevron][marker gutter][content] layout. Any horizontal content shift (e.g. lane drawers) must be genuine .cm-content padding, not a transform.

**Why:** Padding is the only horizontal channel CodeMirror measures, so the caret stays glued to the glyphs; a transform on the content re-enters the WebView2 caret-desync bug that REQ-RENDER-9 fixed. This constraint also forces the lane cascade to be a decorative overlay rather than riding real editor glyphs.

_Source: SPEC §4.1, §7.6; CLAUDE.md 'Editor conventions'_
