---
id: REQ-0078
title: REQ-UI-4 — Command reachability on touch — every editor command has a pointer…
status: approved
opened: 2026-08-17
area: UI
spec_section: §7.1, §5.4
test_type: none (LLM workflow)
---
Command reachability on touch — every editor command has a pointer path, not just a key chord: Undo, Redo, Find & Replace (previously Mod-f only → impossible on touch-only Android), Bold and Italic get hamburger Edit-section entries driving the same EditorApi on the persisted selection/history.
**Live workflows:** WF-37
**Coverage gap:** no deterministic automated test (yet) — see body/notes.

_Note:_ .svelte menu glue (excluded from vitest, like REQ-UI-2) + openSearchPanel/undo/redo; the underlying toggleBold/toggleItalic run through the keymap. Tab-dependent (REQ-UI-5) and table structural (REQ-TBLED-9) commands tracked separately. Covered by WF-37.
