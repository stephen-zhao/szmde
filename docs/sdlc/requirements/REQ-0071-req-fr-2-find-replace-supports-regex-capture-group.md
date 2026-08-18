---
id: REQ-0071
title: REQ-FR-2 — Find/replace supports regex capture-group references in the…
status: approved
opened: 2026-08-17
area: FR
spec_section: §5.4
test_type: unit + integration (DOM)
---
Find/replace supports regex capture-group references in the replacement: $1-style (CM native) and \1-style (translated \1→$1 in regexp mode, leaving \n/\t/\\ and escaped \\1 intact).

**Tests:** editor/replace-groups.test.ts, editor/search-replace.dom.test.ts  (unit + integration (DOM))
