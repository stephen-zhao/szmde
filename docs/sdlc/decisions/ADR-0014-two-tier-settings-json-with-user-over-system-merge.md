---
id: ADR-0014
title: Two-tier settings JSON with user-over-system merge
status: accepted
opened: 2026-08-17
---
**Choice:** effective = deepMerge(systemSettings, userSettings): read-only system.json defaults plus a per-user user.json that the Settings UI writes. Settings are validated against a JSON Schema on load (invalid keys fall back to defaults) and the schema is versioned with a migration step.

**Why:** Separates admin/shipped defaults from user overrides while staying a plain, portable, schema-validated JSON model; versioning + migration gives forward compatibility.

_Source: SPEC §8_
