---
id: ADR-0005
title: Mode 1 (Clean/Formatted) uses reveal-on-cursor
status: accepted
opened: 2026-08-17
---
**Choice:** In Clean mode, a construct's markers become visible only when the cursor enters that construct, then re-hide when it leaves; markers are never revealed for constructs the cursor isn't in.

**Why:** Standard live-preview affordance that lets markers be edited without permanently showing them, honoring the WYSIWYG blank-canvas goal.

_Source: SPEC §4.1, §11_
