---
id: REQ-0055
title: 'REQ-SAVE-3 — Offline draft cache + write queue: an offline-failed write is stashed…'
status: approved
opened: 2026-08-17
area: SAVE
spec_section: §6
test_type: unit
---
Offline draft cache + write queue: an offline-failed write is stashed (coalesced per file) and replayed in order on reconnect; a non-offline failure drops; drafts persist across restarts via a DraftStore seam.

**Tests:** storage/offline.test.ts  (unit)

_Note:_ Shell activation + a live-offline workflow land with a cloud backend, S7.
