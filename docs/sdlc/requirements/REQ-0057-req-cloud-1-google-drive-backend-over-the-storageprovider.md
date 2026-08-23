---
id: REQ-0057
title: REQ-CLOUD-1 — Google Drive backend over the StorageProvider seam (OAuth + Drive…
status: approved
opened: 2026-08-17
area: CLOUD
spec_section: §6
test_type: unit
---
Google Drive backend over the StorageProvider seam (OAuth + Drive REST): read media+etag, write with If-Match optimistic concurrency, stat; HTTP→error mapping (412⇒conflict, 401/403⇒auth, 404⇒not-found, network⇒offline).

**Tests:** storage/gdrive.test.ts, storage/cloud-http.test.ts, storage/oauth.test.ts  (unit)
**Live workflows:** WF-17, WF-33 Part B

_Note:_ Live-wired, open→edit→save round-trip user-verified → WF-17; scope narrowed to non-sensitive drive.file in REQ-CLOUD-3 (pre-existing files via Picker). Android parity M6 S6b — device-verified 2026-07-26 (WF-33 Part B, Pixel 9 Pro): deep-link redirect (reverse-client-id custom scheme), gdrive-connect.ts state-filtered Android branch (storage/gdrive-connect.test.ts); Android Picker deferred to M6.1 so Open from Drive is hidden.
