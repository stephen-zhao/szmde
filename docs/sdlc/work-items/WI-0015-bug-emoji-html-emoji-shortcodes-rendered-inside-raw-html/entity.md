---
id: WI-0015
title: BUG-EMOJI-HTML — Emoji shortcodes rendered inside raw HTML…
status: done
relations:
  implements:
    - REQ-0062
  parent: EPIC-0005
opened: 2026-08-17
---
Emoji shortcodes rendered inside raw HTML blocks/comments/attributes where they should not.

**Fix:** Fixed in the M4 hardening adversarial review (commit 48a0496); no per-bug fix note in the log.

**Violates:** REQ-EMOJI-1
