---
id: REQ-0024
title: REQ-TABLE-1 — GFM pipe table renders as a real <table> in Clean (header/body cells…
status: approved
opened: 2026-08-17
area: TABLE
spec_section: §5.1
test_type: integration (DOM)
---
GFM pipe table renders as a real <table> in Clean (header/body cells, per-column alignment); header-only tables don't crash.

**Tests:** table.dom.test.ts  (integration (DOM))
