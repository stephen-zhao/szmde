---
id: WI-0026
title: B2/B6 — (Syntax) hung block markers (#…, >) were not…
status: done
relations:
  parent: EPIC-0005
  implements:
    - REQ-0067
opened: 2026-08-17
---
(Syntax) hung block markers (#…, >) were not cursor-navigable/selectable — rendered as a replace widget, removed from flow

**Fix:** Switched to an in-flow Decoration.mark so the markers stay real, selectable and arrow-navigable in Syntax mode.

**Violates:** REQ-RENDER-9
