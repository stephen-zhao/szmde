---
id: REQ-0051
title: 'REQ-SET-2 — Settings schema/validation/migration: DEFAULTS…'
status: approved
opened: 2026-08-17
area: SET
spec_section: §8
test_type: unit
---
Settings schema/validation/migration: DEFAULTS, drop-invalid-or-unknown→default, thin partials, version-stamped forward migration.

**Tests:** settings/schema.test.ts, settings/validate.test.ts, settings/migrate.test.ts  (unit)

_Note:_ The two-tier merge itself is REQ-SET-1 / settings/merge.test.ts.
