---
id: REQ-0068
title: REQ-RENDER-11 — Formatted-mode reveal-on-cursor renders markers in Syntax style (not…
status: approved
opened: 2026-08-17
area: RENDER
spec_section: §4.1
test_type: integration (DOM)
---
Formatted-mode reveal-on-cursor renders markers in Syntax style (not raw Source literals): inline marks small-grey in place (hidden→shown); block marks always gutter-hung in flow and reveal flips colour transparent→grey only (invisibleMark→syntaxMark) so content never shifts; revealed markers stay editable.

**Tests:** editor/markers.dom.test.ts  (integration (DOM))
