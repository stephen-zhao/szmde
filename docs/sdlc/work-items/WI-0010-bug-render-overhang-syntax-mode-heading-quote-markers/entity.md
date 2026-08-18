---
id: WI-0010
title: BUG-RENDER-OVERHANG — Syntax-mode heading/quote markers rendered right of the margin…
status: done
relations:
  implements:
    - REQ-0067
    - REQ-0080
  parent: EPIC-0005
opened: 2026-08-17
---
In Syntax mode, heading #... / quote > rendered to the RIGHT of the margin, overlapping the text, instead of hanging in the left gutter — a regression from the B2/B4 in-flow refactor (the width:0; text-align:right overflowed the wrong way).

**Fix:** Re-fixed with an in-flow inline-block pulled left by minus its own measured width: hangs in the gutter, baseline-aligned, flush, editable, no > mirroring. (The width was first applied by a post-layout plugin, which broke cursor gliding and was replaced by a decoration-baked offset — see BUG-CURSOR-GLIDE.)

**Violates:** REQ-RENDER-9, REQ-RENDER-10
