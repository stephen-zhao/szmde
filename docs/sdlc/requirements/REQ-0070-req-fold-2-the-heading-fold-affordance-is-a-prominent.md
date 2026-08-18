---
id: REQ-0070
title: REQ-FOLD-2 — The heading fold affordance is a prominent button chip (border +…
status: approved
opened: 2026-08-17
area: FOLD
spec_section: §5.4
test_type: integration (DOM) + visual
---
The heading fold affordance is a prominent button chip (border + raised fill, role=button + aria-expanded), body-sized so it's identical on any heading level, in its own dedicated left column (REQ-RENDER-12), consistent across all render modes.

**Tests:** editor/fold.dom.test.ts  (integration (DOM) + visual)
**Live workflows:** WF-22

_Note:_ Button attrs unit-covered; live prominence → WF-22.
