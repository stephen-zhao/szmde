---
id: ADR-0016
title: 'Process: no ad-hoc work — every change traces to a REQ + SPEC section…'
status: accepted
opened: 2026-08-17
---
**Choice:** Every unit of work maps to a REQ-* id and a SPEC section before it starts (new behavior => catalogue a REQ; new scope => add to SPEC + roadmap). Strict TDD then 100%-lines coverage (ratcheted, explicit reviewed exclusions), requirement<->test traceability tagged in describe() titles and CI-audited, live/interaction behavior covered by the LLM workflow (WF-*) suite before fixing a live bug, adversarial multi-agent ('ultracode') review on substantial changes, and no hardcoded counts in prose docs.

**Why:** Keeps scope disciplined and auditable: nothing beyond a trivial fix ships without spec+milestone+requirement, coverage/traceability are machine-enforced, and prose stating properties+commands (not counts) avoids rot on every commit.

_Source: CLAUDE.md 'Process — no ad-hoc work'; SPEC §10_
