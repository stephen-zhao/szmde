---
id: REQ-0059
title: REQ-CLOUD-3 — Least-privilege Drive access via the system-browser Google Picker…
status: approved
opened: 2026-08-17
area: CLOUD
spec_section: §6
test_type: unit + unit (Rust)
---
Least-privilege Drive access via the system-browser Google Picker: scope narrowed to non-sensitive drive.file; pre-existing files opened through the desktop Picker (trigger_onepick + prompt=consent) over the loopback, a pick doubling as sign-in; loopback hardened with a Host-header allowlist.

**Tests:** storage/gdrive-connect.test.ts, src-tauri/src/lib.rs  (unit + unit (Rust))
**Live workflows:** WF-28

_Note:_ pickGoogleDriveFiles / oauth_pick_await / parse_redirect / parse_error / host_allowed; DNS-rebinding → 403; S1 spike 2026-07-11 confirmed bare 127.0.0.1 redirect works (no HTTPS relay); live pick→open→save → WF-28. Design: gdrive-picker-plan.md.
