---
id: ADR-0017
title: Left-edge columns are configurable lanes with per-lane display strategies…
status: accepted
opened: 2026-08-17
---
**Choice:** Generalize the fixed [fold chevron][marker gutter][content] columns into named lanes, each with a display strategy (reserved / drawer / off) driven by a versioned settings model (ordered lane-id list + per-lane objects with strategy, drawerHeight, per-breakpoint default). Drawer lanes collapse off the left edge and, when built, follow the finger on swipe. The syntax-marker lane is mandatory (may be reserved or drawer, never off).

**Why:** On narrow (phone) viewports the reserved lanes consume a large share of the line and the marker gutter is usually empty in Formatted mode, so a lane must earn its width. The marker lane can't be off because markers are real text (§1.5) and modes 2/3 are unusable without room to show them. Defaults keep wide/desktop byte-identical to the pre-lane layout while phones auto-collapse the empty gutter.

_Source: SPEC §7.6; CLAUDE.md 'Editor conventions'_
