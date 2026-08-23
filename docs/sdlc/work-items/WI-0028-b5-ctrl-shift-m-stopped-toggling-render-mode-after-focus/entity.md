---
id: WI-0028
title: B5 — Ctrl+Shift+M stopped toggling render mode after focus…
status: done
relations:
  parent: EPIC-0002
  implements:
    - REQ-0007
opened: 2026-08-17
---
Ctrl+Shift+M stopped toggling render mode after focus drifted off the editor

**Fix:** Added an app-level keyboard fallback guarded by defaultPrevented; the mode chip restores editor focus.

**Violates:** REQ-RENDER-7
