---
id: ADR-0015
title: Windows-native-first delivery (documented exception to WSL-first)
status: accepted
opened: 2026-08-17
---
**Choice:** szmde is built and shipped Windows-native first (WebView2); macOS/web share the frontend and Android is a later milestone. This is a documented exception to the user's otherwise WSL-first development norm.

**Why:** Tauri cannot cross-compile the Windows/WebView2 target from WSL, so the app must be developed natively on Windows. Single shared frontend still targets all platforms via the thin native-bridge layer.

_Source: CLAUDE.md 'Stack' & 'Shell note'; SPEC §2_
