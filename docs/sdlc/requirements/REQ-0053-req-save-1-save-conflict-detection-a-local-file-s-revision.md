---
id: REQ-0053
title: 'REQ-SAVE-1 — Save conflict detection: a local file''s revision (mtime-len) is…'
status: approved
opened: 2026-08-17
area: SAVE
spec_section: §6
test_type: unit + unit (Rust)
---
Save conflict detection: a local file's revision (mtime-len) is baseline; a save over a disk-changed file is detected (rev mismatch → StorageError conflict) and offers overwrite / save-copy / reload.

**Tests:** storage/local.test.ts, storage/conflict.test.ts, src-tauri/src/lib.rs  (unit + unit (Rust))
**Live workflows:** WF-15

_Note:_ The modal interaction → WF-15.
