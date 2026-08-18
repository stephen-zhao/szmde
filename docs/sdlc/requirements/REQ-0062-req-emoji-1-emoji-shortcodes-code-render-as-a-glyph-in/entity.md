---
id: REQ-0062
title: 'REQ-EMOJI-1 — Emoji shortcodes :code: render as a glyph in Clean mode (literal kept…'
status: approved
opened: 2026-08-17
area: EMOJI
spec_section: §5.4
test_type: unit + integration (DOM)
---
Emoji shortcodes :code: render as a glyph in Clean mode (literal kept on disk, reveal-on-cursor, atomic); unknown/inline-code/fenced/URL stay literal; Source/Syntax keep literal; gated by markdown.emoji.

**Tests:** editor/emoji.test.ts, editor/emoji.dom.test.ts  (unit + integration (DOM))
**Live workflows:** WF-21

_Note:_ Live glyph render → WF-21.
