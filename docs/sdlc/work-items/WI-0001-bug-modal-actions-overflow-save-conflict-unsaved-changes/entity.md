---
id: WI-0001
title: BUG-MODAL-ACTIONS-OVERFLOW — Save-conflict / unsaved-changes modal action row can push the…
status: ready
relations:
  implements:
    - REQ-0053
  parent: EPIC-0010
opened: 2026-08-17
---
The modal's .modal-actions is a single non-wrapping flex row, so on a narrow phone (<=375px) the primary Overwrite/Save button can be pushed off-screen, making conflict resolution unreachable. Found in the M6 S2 adversarial review. Needs a live check (happy-dom has no layout).

**Violates:** REQ-SAVE-1
