---
id: ADR-0012
title: Network storage ships both SMB/CIFS and WebDAV in v1
status: accepted
opened: 2026-08-17
---
**Choice:** Ship both SMB/CIFS and WebDAV in v1, implemented in the Rust bridge. Desktop gets both protocols; the web build is WebDAV-only; Android is WebDAV-first (raw SMB limited there).

**Why:** SMB is the lead use case (home/office NAS shares). WebDAV is required to unlock network storage on the web build, since browsers cannot reach raw SMB. Both behind the StorageProvider seam.

_Source: SPEC §6_
