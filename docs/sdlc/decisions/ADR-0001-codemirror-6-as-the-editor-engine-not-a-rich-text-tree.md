---
id: ADR-0001
title: CodeMirror 6 as the editor engine, not a rich-text tree engine
status: accepted
opened: 2026-08-17
---
**Choice:** Use CodeMirror 6 with a custom markdown live-preview extension; the document is always the raw markdown text, and decorations hide/style/grey the markers. Reject ProseMirror/TipTap and Lexical.

**Why:** Requirement 8 (markers as real, arrow-navigable, deletable text in modes 2/3) is the deciding factor. ProseMirror-family engines model the doc as a tree of nodes+marks where the '**' characters do not exist; making syntax markers behave as real text fights that model. CM6's text model plus decorations gives selection/navigation/deletion of markers for free, matches Obsidian Live Preview, and is fast/virtualized (zero-lag typing).

_Source: SPEC §3, §3.1_
