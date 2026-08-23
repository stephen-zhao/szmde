---
id: WI-0011
title: BUG-FIND-SIZES — Find/replace panel had three different text sizes…
status: done
relations:
  implements:
    - REQ-0081
  parent: EPIC-0005
opened: 2026-08-17
---
Find/replace panel had THREE different text sizes (buttons largest, checkbox labels medium, entry boxes smallest). The C1/REQ-FR-3 fix targeted input[type=text], but CM's inputs have no type attr so it never matched (they kept CM's .cm-textfield{font-size:70%}), and CM's & label{font-size:80%} shrank the checkbox labels.

**Fix:** Target .cm-textfield (not input[type=text]) and out-rank CM's label rule with .cm-search.cm-panel label. Verified live: all panel text now a uniform 13.6px.

**Violates:** REQ-FR-3
