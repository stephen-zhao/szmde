---
id: EPIC-0004
title: M3 — Cloud storage
status: closed
relations:
  implements:
    - REQ-0053
    - REQ-0054
    - REQ-0055
    - REQ-0056
    - REQ-0057
    - REQ-0058
    - REQ-0086
opened: 2026-08-17
---
StorageProvider seam + LocalProvider; resilience layer (conflict/autosave/offline queue); SecureStore seam + token model; OAuth 2.0 + PKCE; both cloud backends. Google Drive live-wired (uses full drive scope originally); OneDrive backend-only (m3-plan.md, SPEC §6, §8).
