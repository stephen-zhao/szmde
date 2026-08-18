---
id: ADR-0004
title: Markers are first-class real text, never margin decorations
status: accepted
opened: 2026-08-17
---
**Choice:** The markdown syntax characters (**, #, >, etc.) live in the underlying text and stay selectable/navigable/editable in all modes; never push markers into margins or model them as hidden decorations bolted onto a tree. Chars that ARE the widget (e.g. a task's [ ]) are content, not 'just syntax' — never small-grey them in Syntax mode.

**Why:** Core product principle (§1.5): editing/deleting a marker changes formatting and typing one applies it live; this only works if markers are ordinary text. Distinguishing marker-vs-widget chars prevents mis-styling real content as syntax.

_Source: SPEC §1, §4.1; CLAUDE.md 'Editor conventions'_
