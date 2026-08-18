---
id: ADR-0023
title: Branch/PR workflow with name-matched branch protection
status: accepted
opened: 2026-08-17
---
**Choice:** Once CI is in place, stop committing directly to main: branch → push → PR → merge only when CI is green. Branch protection requires both status checks, matched by the job's name: ('Frontend gate …' / 'Rust (fmt · clippy · test)'), not its YAML id, and requires a PR.

**Why:** GitHub (and gh pr checks) lists checks by job name; matching by YAML id would silently fail to enforce them.

_Source: docs/ci-cd.md_
