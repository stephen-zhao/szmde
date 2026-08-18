---
id: WI-0003
title: BUG-ALERT-ICON-OVERLAP — Formatted-mode GFM alert/callout boxes render the type icon…
status: ready
relations:
  implements:
    - REQ-0022
  parent: EPIC-0010
opened: 2026-08-17
---
In Formatted mode, GFM alert/callout boxes (> [!TIP], > [!WARNING], ...) render with the type icon overlapping the label/body text instead of beside it. Likely the icon's absolute/negative positioning vs the label's left padding. Needs a live WF (happy-dom has no layout); check every alert type and a long wrapping body.

**Violates:** REQ-ALERT-1
