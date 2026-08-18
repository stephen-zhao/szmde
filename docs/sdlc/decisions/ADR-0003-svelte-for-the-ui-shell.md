---
id: ADR-0003
title: Svelte for the UI shell
status: accepted
opened: 2026-08-17
---
**Choice:** Use Svelte (over Lit) for hamburger menu, settings, dialogs; CM6 owns the editor surface.

**Why:** Tiny runtime and minimal overhead fit the 'barely any UI / blank canvas' goal and keep memory/CPU headroom for the editor engine.

_Source: SPEC §3_
