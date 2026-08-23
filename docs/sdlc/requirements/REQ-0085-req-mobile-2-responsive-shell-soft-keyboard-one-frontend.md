---
id: REQ-0085
title: 'REQ-MOBILE-2 — Responsive shell + soft keyboard: one frontend from desktop down to…'
status: approved
opened: 2026-08-17
area: MOBILE
spec_section: §7, §2
test_type: none (LLM workflow)
---
Responsive shell + soft keyboard: one frontend from desktop down to phone widths (<600px drawer layout, touch-sized targets, additive env(safe-area-inset-*) insets, and a native IME-inset bridge MainActivity.kt → --kb-inset shrinking .app and lifting the status bar when the keyboard opens).
**Live workflows:** WF-29, WF-30, WF-31
**Coverage gap:** no deterministic automated test (yet) — see body/notes.

_Note:_ Layout + a Kotlin/WebView bridge: happy-dom has no CSS box model, media queries, or IME. Covered by WF-29 (widths/safe-areas), WF-30 (keyboard — physical device only; emulator misleading), WF-31 (the REQ-SCROLL-1 anchor that makes the keyboard case usable).
