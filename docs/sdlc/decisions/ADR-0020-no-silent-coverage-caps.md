---
id: ADR-0020
title: No silent coverage caps
status: accepted
opened: 2026-08-17
---
**Choice:** Every coverage exclusion is explicit and reviewed; genuinely-unreachable lines carry /* v8 ignore */ with a stated reason.

**Why:** No-silent-caps principle — an exclusion is never a silent gap.

_Source: docs/testing-strategy.md_
