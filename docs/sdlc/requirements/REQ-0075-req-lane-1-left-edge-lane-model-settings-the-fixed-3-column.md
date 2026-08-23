---
id: REQ-0075
title: 'REQ-LANE-1 — Left-edge lane model + settings: the fixed 3-column left edge…'
status: approved
opened: 2026-08-17
area: LANE
spec_section: §7.6
test_type: unit
---
Left-edge lane model + settings: the fixed 3-column left edge (REQ-RENDER-12) becomes a named-lane settings model (settings.lanes) — an ordered lane-id list (order IS left-to-right) + per-lane strategy (reserved/drawer/off) and drawerHeight z-order; a code-side LANE_REGISTRY (settings/lanes.ts) is the source of truth; applyLanes derives width vars from strategy; validation is bespoke and never throws; v2→v3 additive; DEFAULTS reproduce today's layout exactly.

**Tests:** settings/lanes.test.ts, settings/validate.test.ts, settings/migrate.test.ts, settings/schema.test.ts  (unit)

_Note:_ SPEC §7.6 mandatory-marker carve-out (marker may be reserved/drawer but never off; validation coerces); off → 0px + hides affordance via --fold-chevron-display; drawer reserves width like reserved until drawers ship; the .svelte store glue that calls applyLanes is vitest-excluded like the other adapters.
