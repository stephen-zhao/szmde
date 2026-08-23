---
id: WI-0002
title: BUG-FIND-PANEL-INSET — Find & Replace panel has no top safe-area inset, laying out…
status: ready
relations:
  implements:
    - REQ-0061
  parent: EPIC-0010
opened: 2026-08-17
---
The Find & Replace panel (.cm-panels-top) has no top safe-area inset, so on a phone it lays out at viewport y=0, inside the ~52px status-bar band. Currently masked (Find is keyboard-only, so it can't be opened on a phone at all); REQ-UI-4 (M6.2) unmasks it and both should be fixed together. Inset belongs on .cm-panels.cm-panels-top (additive env()). Found in the M6 S2 adversarial review.

**Violates:** REQ-FR-1
