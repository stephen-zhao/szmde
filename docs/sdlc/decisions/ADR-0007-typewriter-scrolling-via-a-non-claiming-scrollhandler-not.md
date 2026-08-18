---
id: ADR-0007
title: Typewriter scrolling via a non-claiming scrollHandler, not scrollMargins
status: accepted
opened: 2026-08-17
---
**Choice:** Implement typewriter scrolling as an EditorView.scrollHandler that never claims the scroll — it schedules a measure-phase adjustment. The active line never rests below a two-thirds-down anchor (one-directional: lines at/above the anchor are left where they are). Do NOT reimplement with scrollMargins, and never call coordsAtPos from the handler itself.

**Why:** scrollMargins also drives paging, drag-select and tooltips, so it is the wrong mechanism. coordsAtPos throws inside CodeMirror's update and CM swallows it silently. The two-thirds anchor beat centering (0.5), which phone user-testing read as too high; it also clears the soft keyboard and status chips as a side effect.

**Supersedes:** Centered (0.5) typewriter anchor

_Source: SPEC §4.5; CLAUDE.md 'Editor conventions'_
