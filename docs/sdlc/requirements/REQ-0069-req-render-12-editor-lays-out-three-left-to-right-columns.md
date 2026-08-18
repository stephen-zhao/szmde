---
id: REQ-0069
title: REQ-RENDER-12 — Editor lays out three left-to-right columns [fold chevron][marker…
status: approved
opened: 2026-08-17
area: RENDER
spec_section: §4.1/§5.4/§7
test_type: integration (DOM) + visual
---
Editor lays out three left-to-right columns [fold chevron][marker gutter][content] reserved as .cm-content left padding (--fold-col + --marker-gutter, sized off --editor-font-size); the fold chevron lives in its own absolutely-positioned column so its lane is fixed regardless of heading depth; columns reserved in every render mode so toggling/revealing never shifts text.

**Tests:** editor/markers.dom.test.ts, editor/fold.dom.test.ts  (integration (DOM) + visual)
**Live workflows:** WF-24

_Note:_ Fixes the old chevron/deep-###### hung-marker overlap; live columns/no-overlap → WF-24.
