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
| [gdrive-picker-plan.md](gdrive-picker-plan.md) | Design + staged plan for the least-privilege Google Drive picker (REQ-CLOUD-3, shipped) |
| [m6-plan.md](m6-plan.md) | M6 (Android) architecture + staged slices + toolchain setup (current milestone) |
| [gdrive-picker-s1-runbook.md](gdrive-picker-s1-runbook.md) | S1 spike runbook — resolve the picker `redirect_uri` crux (Cloud Console + a Node spike script) |

## Archive (historical — completed-milestone plans)

Per-milestone build plans (`m<N>-plan.md`) for shipped milestones live in [archive/](archive/) —
kept as provenance, **not** current-state tracking. See [archive/README.md](archive/README.md); the
folder listing itself is the index.

## Conventions

- Tests tag their `REQ-*` in the `describe(...)` name; `npm run test:trace` checks
  every catalogued requirement has a tagged test (or a tracked gap).
- New milestones add a `m<N>-plan.md`; it moves to [archive/](archive/) once the milestone ships.
  Requirements always land in requirements.md and bugs in bugs.md regardless.
