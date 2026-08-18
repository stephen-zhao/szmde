---
id: REQ-0074
title: 'REQ-LANE-4 — Collapsible lane drawers — model + static collapse: a drawer lane can…'
status: approved
opened: 2026-08-17
area: LANE
spec_section: §7.6
test_type: unit + integration (DOM)
---
Collapsible lane drawers — model + static collapse: a drawer lane can collapse to reclaim width, animating open⇄closed, with a per-breakpoint defaultOpen (narrow auto-collapse, wide open); mechanism is an open scalar ∈[0,1] per lane that theme.ts multiplies its reserved width by, so open=1 is byte-identical to REQ-RENDER-12; content shift is genuine padding so the caret stays glued.

**Tests:** editor/lane-open.test.ts, editor/lane-drawers.dom.test.ts, settings/schema.test.ts, settings/validate.test.ts  (unit + integration (DOM))
**Live workflows:** WF-39

_Note:_ editor/lane-drawers.ts: laneOpenField StateField seeded from laneOpenSeed facet (re-seeded on every setState so a collapse survives opening another file), setLaneOpen effect, laneDrawers ViewPlugin rAF-tween writing scalars on outer .cm-editor (view.dom) with a keyed per-frame re-measure; pure policy editor/lane-open.ts (resolveLaneOpen/openForLane/resolveDefaultOpen/stepOpen); breakpoint matchMedia(max-width:600px) + View → Side lanes toggle. Pending (tracked, not built): touch finger-follow reveal (partial peek) and the decorative overtaking cascade (later slices, SPEC §7.6). Live feel → WF-39.
