# Findings

Bare loopback WORKS on the existing Desktop-app client. trigger_onepick redirected straight to http://127.0.0.1:PORT with ?state=…&iss=https://accounts.google.com&picked_file_ids=<id>&code=…&scope=…/drive.file and a matching state — no redirect registration, no public-HTTPS relay. The docs' 'must be a public HTTPS URL' wording did not bind in practice. Undocumented iss param present; the parser tolerates unknown params. Resolves open risks #1-3; S4 (HTTPS relay) skipped entirely.

_Investigated 2026-07-11, source: docs/gdrive-picker-s1-runbook.md (result recorded in docs/gdrive-picker-plan.md)._
