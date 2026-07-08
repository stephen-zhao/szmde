# docs/archive

Historical, **completed-milestone planning artifacts**. Each captured the design and slice-by-slice
build plan for a milestone that has since shipped and merged to `main`. They are preserved as
**provenance** — why the code is shaped the way it is — and must **not** be read as current-state
tracking.

**For current state, always use the living docs:**

- [../roadmap.md](../roadmap.md) — authoritative milestone tracker (shipped vs. next).
- [../requirements.md](../requirements.md) — `REQ` registry + test traceability (the source of truth
  for behavior, including the as-built inline-table-editor model).
- [../bugs.md](../bugs.md) — live bug log.
- [../../SPEC.md](../../SPEC.md) — product vision / foundation.
- [../../CLAUDE.md](../../CLAUDE.md) — project conventions & current-state summary.

## Contents

| Doc | Milestone | Status / what changed since |
|-----|-----------|-----------------------------|
| [m1-plan.md](m1-plan.md) | M1 — Core WYSIWYG | Shipped. The render mode called **"Clean"** here now displays as **"Formatted"** (Markers-rendered → **"Source"**, Markers-syntax → **"Syntax"**). |
| [m2-plan.md](m2-plan.md) | M2 — Remaining v1 blocks + settings | Shipped. The M2 render-only + reveal-to-source table model was **superseded by M5** (inline per-cell editor; the table stays rendered). |
| [m3-plan.md](m3-plan.md) | M3 — Cloud storage | Shipped. **Google Drive is live-wired** (full `drive` scope, round-trip verified); **OneDrive is backend-only** (no live wiring yet). The ⬜ L3/L4 markers inside are historical. |
| [m4-plan.md](m4-plan.md) | M4 — Authoring essentials | Shipped 2026-06-28. Two as-planned designs diverged during build: page-width is a **numeric-px `lineWidth`** (not an enum), and the fold affordance is a **button chip in a dedicated fold column** (not a gutter-less inline chevron). |
| [m5-plan.md](m5-plan.md) | M5 — Rich table editing | S1–S6 shipped; **S7 (toggle header, REQ-TBLED-2) pending**. REQ-TBLED-7 shipped as an **inline cell editor over an atomic rendered table** — the "reveal-to-pipes / arrows-enter-table" wording in the body is **superseded** (see requirements.md REQ-TBLED-7). |
| [m4-feedback-triage.md](m4-feedback-triage.md) | M4 — review round | Complete — a frozen point-in-time triage record. |

## Rule

Do not edit these to reflect new state. When behavior changes, update the **living** docs. These
files change only to add a dated "superseded / as-built" banner pointing at the living source of truth.
