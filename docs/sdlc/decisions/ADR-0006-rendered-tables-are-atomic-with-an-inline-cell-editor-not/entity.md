---
id: ADR-0006
title: Rendered tables are atomic with an inline cell editor, not reveal-to-pipes
status: accepted
opened: 2026-08-17
---
**Choice:** A rendered table stays rendered and is treated as an atomic unit — arrow keys skip past it rather than entering it. To edit, click a cell to open an inline <textarea> over that cell's markdown source (Enter/Tab commit+move, Esc cancels, blur commits). Raw pipe source appears in Source mode only. Do NOT reintroduce the old reveal-to-pipes / arrows-enter-table model.

**Why:** Tables are the deliberate exception to reveal-on-cursor; structured inline editing over portable GFM pipe tables is far more usable than un-rendering the whole table to raw pipes. On disk it stays plain GFM.

**Supersedes:** Earlier reveal-to-pipes / arrows-enter-table table model

_Source: SPEC §4.1, §7.4; CLAUDE.md 'Editor conventions'_
