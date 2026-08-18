---
id: REQ-0082
title: REQ-ZOOM-4 — Page-width range accounts for all three columns (REQ-RENDER-12)…
status: approved
opened: 2026-08-17
area: ZOOM
spec_section: §7.3
test_type: none (LLM workflow)
---
Page-width range accounts for all three columns (REQ-RENDER-12) — chevron + marker gutter reserved inside --reading-width (border-box) so the window-width max keeps every column on-screen.
**Live workflows:** WF-24
**Coverage gap:** no deterministic automated test (yet) — see body/notes.

_Note:_ Fixes the old negative-margin chevron clipping when maxed. Pure layout (border-box padding) — happy-dom has no layout; covered by WF-24.
