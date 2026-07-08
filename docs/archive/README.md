# docs/archive

Historical, **completed-milestone planning artifacts**. Each captured the design and slice-by-slice
build plan for a milestone that has since shipped and merged to `main`. They are kept as
**provenance** — why the code is shaped the way it is — and must **not** be read as current-state
tracking. Every file opens with a dated "Archived" banner pointing back at the living docs; where a
plan's design diverged from what shipped, its banner says so.

**For current state, always use the living docs:**

- [../roadmap.md](../roadmap.md) — authoritative milestone tracker (shipped vs. next).
- [../requirements.md](../requirements.md) — `REQ` registry + test traceability (source of truth for behavior).
- [../bugs.md](../bugs.md) — live bug log.
- [../../SPEC.md](../../SPEC.md) — product vision / foundation.
- [../../CLAUDE.md](../../CLAUDE.md) — project conventions & current-state summary.

## Rule

Don't maintain a manifest of these files here — the folder listing is the index. Don't edit them to
reflect new state either: when behavior changes, update the **living** docs. An archived plan changes
only to add a dated "superseded / as-built" banner pointing at the living source of truth.
