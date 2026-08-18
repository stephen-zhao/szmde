---
id: ADR-0002
title: Tauri 2 desktop wrapper, not Electron
status: accepted
opened: 2026-08-17
---
**Choice:** Ship desktop (and Android) via Tauri 2 with a Rust native bridge; one project targets Windows + macOS + Android from a single TypeScript frontend.

**Why:** Small binaries (~3-10 MB vs Electron ~100 MB+), native filesystem via Rust, low memory keeps CPU/RAM headroom for the editor. Electron was also rejected on the marker-as-text requirement, not only size.

_Source: SPEC §3, §3.1_
