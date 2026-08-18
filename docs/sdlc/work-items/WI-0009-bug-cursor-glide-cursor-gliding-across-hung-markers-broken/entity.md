---
id: WI-0009
title: BUG-CURSOR-GLIDE — Cursor gliding across hung markers broken; marker offset from a…
status: done
relations:
  implements:
    - REQ-0067
  parent: EPIC-0005
opened: 2026-08-17
---
Cursor gliding across the hung markers was broken: the marker offset was set by a POST-LAYOUT plugin (margin-left from offsetWidth after CM laid out). CM recreates marker spans on every line re-render (caret move / scroll), losing the JS style until the plugin re-ran, so the marker flicked between gutter and margin and the native caret landed in the wrong place inconsistently.

**Fix:** Bake the offset into the DECORATION (inline margin-left:-<canvas-measured width>) so CM re-applies it on every render -> marker always placed, caret glides consistently. Removed the measure plugin; trailing space is a separate in-flow token. Added cursor-glide contract tests (markers.dom.test.ts) across all 3 modes. Verified live. (M4 round 3.)

**Violates:** REQ-RENDER-9
