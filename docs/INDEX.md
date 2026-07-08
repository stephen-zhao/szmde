# szmde docs — index

The map of where everything lives, so progress and workstreams are trackable from
one place.

## Plan & spec (the foundation)

| Doc | Purpose |
|-----|---------|
| [../CLAUDE.md](../CLAUDE.md) | Project guide for contributors/agents — stack, the no-ad-hoc-work + REQ/traceability/coverage process, storage & editor conventions, current-state summary |
| [SPEC.md](../SPEC.md) | The specification — product principles, decisions, the "what" (§-numbered, referenced throughout these docs) |
| [roadmap.md](roadmap.md) | The authoritative milestone tracker — **shipped (M0–M5)** / next (M5 S7, then M6 Android) / backlog + engineering-infra, each item tied to a SPEC § and a `REQ-*` |

## Central registries (the two "single sources of truth")

| Want to see… | Go to |
|--------------|-------|
| **All requirements** (what the app must do) + their tests | [requirements.md](requirements.md) — the requirements registry (`REQ-*`), plus a "no automated test" gaps section |
| **All reported bugs** + status | [bugs.md](bugs.md) — the bug log (open / fixed / known limitations) |

Rule of thumb: a piece of feedback is a **bug** (→ bugs.md) if it violates an
existing `REQ-*`; it's a **new requirement** (→ requirements.md) if the behavior
was under-specified. Each round's classification is recorded in a triage doc.

## Working / reference docs (living)

| Doc | Purpose |
|-----|---------|
| [testing-strategy.md](testing-strategy.md) | The T1–T4 testing gate — 100% coverage, integration tests, requirement↔test traceability; CI-enforced |
| [ci-cd.md](ci-cd.md) | GitHub Actions CI gate + tag-triggered Windows release; the branch/PR workflow |
| [llm-workflow-tests.md](llm-workflow-tests.md) | Live-behavior test scripts (`WF-*`) for things happy-dom can't cover, each linked to a `REQ-*` |
| [m3-cloud-setup.md](m3-cloud-setup.md) | Human steps to register the Google/Azure OAuth apps (Google Drive is live; OneDrive pending) |

## Archive (historical — completed-milestone plans)

Per-milestone build plans for shipped milestones live in [archive/](archive/) — kept as provenance,
**not** current-state tracking (see [archive/README.md](archive/README.md)):

| Doc | Purpose |
|-----|---------|
| [archive/m1-plan.md](archive/m1-plan.md) | M1 (core WYSIWYG) architecture + slices |
| [archive/m2-plan.md](archive/m2-plan.md) | M2 (remaining v1 blocks + settings) architecture + slices |
| [archive/m3-plan.md](archive/m3-plan.md) | M3 (cloud storage) architecture + slices + live-wiring tail |
| [archive/m4-plan.md](archive/m4-plan.md) | M4 (authoring essentials) architecture + slices |
| [archive/m5-plan.md](archive/m5-plan.md) | M5 (rich table editing) architecture + slices |
| [archive/m4-feedback-triage.md](archive/m4-feedback-triage.md) | M4 review feedback, each comment classified bug-vs-requirement |

## Conventions

- Tests tag their `REQ-*` in the `describe(...)` name; `npm run test:trace` checks
  every catalogued requirement has a tagged test (or a tracked gap).
- New milestones add a `m<N>-plan.md`; it moves to [archive/](archive/) once the milestone ships.
  Requirements always land in requirements.md and bugs in bugs.md regardless.
