---
id: ADR-0019
title: Ratchet coverage up; hold honest floors rather than fake the last percent
status: accepted
opened: 2026-08-17
---
**Choice:** Ratchet the coverage threshold up toward 100% rather than flip 100% on at once; hold floors lines 100 / statements,functions 98 / branches 93 instead of writing contrived tests for the residual.

**Why:** Avoids blocking on a big-bang backfill; the residual gaps are defensive state.field(_,false) guards, single-line-fence edges, and CM widget-diff plumbing only the real WebView exercises.

_Source: docs/testing-strategy.md_
