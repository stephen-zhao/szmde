---
id: REQ-0083
title: REQ-CLI-3 — wsl_to_unc translates a WSL path to a UNC path.
status: approved
opened: 2026-08-17
area: CLI
spec_section: §6.1
test_type: none (integration; needs WSL)
---
wsl_to_unc translates a WSL path to a UNC path.
**Coverage gap:** no deterministic automated test (yet) — see body/notes.

_Note:_ Shells out to wsl.exe → integration, not a unit; needs WSL present. No WF referenced.
