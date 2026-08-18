---
id: ADR-0010
title: EOL is explicitly managed as write-time metadata; default LF everywhere
status: accepted
opened: 2026-08-17
---
**Choice:** New documents default to LF on every platform including Windows. On open, detect existing EOL; the buffer stays LF internally and the chosen EOL is applied only at save time (toggling marks the doc dirty). Mixed-EOL files are normalized to the active setting on first save.

**Why:** Managing EOL as write-time metadata rewrites line endings on disk without churning the buffer/undo history. LF-default matches what WSL files want anyway. This replaces the earlier passive-preserve approach.

**Supersedes:** Earlier 'preserve EOL untouched' behavior

_Source: SPEC §4.4, §6.1_
