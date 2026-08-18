---
id: ADR-0026
title: Ship unsigned Windows installers
status: accepted
opened: 2026-08-17
---
**Choice:** Ship unsigned Windows installers (no code-signing cert configured); accept the one-time SmartScreen 'unknown publisher' warning (More info → Run anyway). Not yet built: macOS/Linux installers, auto-update, Windows signing, Play Store publishing (REQ-PLAY-1, its own milestone).

**Why:** Windows signing can be added later by supplying a cert + repo secrets and wiring them into the action; M6 ships the sideload APK (m6-plan decision #4).

_Source: docs/ci-cd.md_
