# szmde docs — index

The map of where everything lives, so progress and workstreams are trackable from
one place.

## Plan & spec (the foundation)

| Doc | Purpose |
|-----|---------|
| [SPEC.md](../SPEC.md) | The specification — product principles, decisions, the "what" (§-numbered, referenced throughout these docs) |
| [roadmap.md](roadmap.md) | The authoritative milestone tracker — shipped / scheduled (M3+) / backlog + engineering-infra, each item tied to a SPEC § and a `REQ-*` |

## Central registries (the two "single sources of truth")

| Want to see… | Go to |
|--------------|-------|
| **All requirements** (what the app must do) + their tests | [requirements.md](requirements.md) — the requirements registry (`REQ-*`), plus a "no automated test" gaps section |
| **All reported bugs** + status | [bugs.md](bugs.md) — the bug log (open / fixed / known limitations) |

Rule of thumb: a piece of feedback is a **bug** (→ bugs.md) if it violates an
existing `REQ-*`; it's a **new requirement** (→ requirements.md) if the behavior
was under-specified. Each round's classification is recorded in a triage doc.

## Working / reference docs

| Doc | Purpose |
|-----|---------|
| [m3-plan.md](m3-plan.md) | M3 (cloud storage) architecture + slices + live-wiring tail |
| [m4-plan.md](m4-plan.md) | M4 (authoring essentials) architecture + slices |
| [m4-feedback-triage.md](m4-feedback-triage.md) | M4 review feedback, each comment classified bug-vs-requirement |
| [m3-cloud-setup.md](m3-cloud-setup.md) | Human steps to register the Google/Azure OAuth apps |
| [llm-workflow-tests.md](llm-workflow-tests.md) | Live-behavior test scripts (`WF-*`) for things happy-dom can't cover, each linked to a `REQ-*` |

## Conventions

- Tests tag their `REQ-*` in the `describe(...)` name; `npm run test:trace` checks
  every catalogued requirement has a tagged test (or a tracked gap).
- New milestones add a `m<N>-plan.md`; ad-hoc tasks may add their own scratch
  `*.md` — but requirements still land in requirements.md and bugs in bugs.md.
