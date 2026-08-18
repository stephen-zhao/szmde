---
id: REQ-0058
title: REQ-CLOUD-2 — OneDrive backend over the StorageProvider seam (OAuth + Microsoft…
status: approved
opened: 2026-08-17
area: CLOUD
spec_section: §6
test_type: unit
---
OneDrive backend over the StorageProvider seam (OAuth + Microsoft Graph): Graph item content read/write (PUT) with If-Match, stat; same shared error mapping as Drive.

**Tests:** storage/onedrive.test.ts, storage/cloud-http.test.ts, storage/oauth.test.ts  (unit)
**Live workflows:** WF-18

_Note:_ Backend + unit tests only — live wiring (onedrive-connect orchestration + UI entry mirroring gdrive-connect.ts) not built yet, so WF-18 isn't runnable.
