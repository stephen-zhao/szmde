---
id: REQ-0080
title: REQ-RENDER-10 — Syntax/Formatted-reveal hung block markers are baseline-aligned with…
status: approved
opened: 2026-08-17
area: RENDER
spec_section: §4.1
test_type: none (LLM workflow)
---
Syntax/Formatted-reveal hung block markers are baseline-aligned with the heading/quote text.
**Live workflows:** WF-24
**Coverage gap:** no deterministic automated test (yet) — see body/notes.

_Note:_ The hung prefix is ordinary in-flow small-grey text shifted by the line's text-indent so it sits on the natural baseline (no inline-block top-float); happy-dom has no layout — covered by WF-24.
