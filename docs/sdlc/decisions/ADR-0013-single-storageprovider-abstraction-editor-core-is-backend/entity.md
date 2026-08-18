---
id: ADR-0013
title: Single StorageProvider abstraction; editor core is backend-agnostic
status: accepted
opened: 2026-08-17
---
**Choice:** All I/O goes through one StorageProvider interface (open/list/read/write/save-as, optional watch, capabilities); the editor core never knows which backend it talks to. Side-effectful ops like rename commit through the seam (real artifact renamed on disk / via the backend), and backends advertise unsupported ops through capabilities.

**Why:** Keeps every backend (local/WSL-UNC, Drive, OneDrive, SMB, WebDAV) interchangeable and the on-disk artifact portable GFM for all of them; new backends slot in without touching editor or UI code.

_Source: SPEC §6, §7.1, §9; CLAUDE.md 'Storage seam'_
