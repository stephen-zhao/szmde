---
id: ADR-0011
title: Underline deferred from v1; custom __x__ syntax rejected
status: accepted
opened: 2026-08-17
---
**Choice:** Drop underline from v1 (bold/italic/strikethrough cover the baseline). When revisited, the leading option is <u>…</u> via a small HTML render allowlist. A custom __x__ mapping is explicitly rejected.

**Why:** CommonMark/GFM has no native underline; there is no portable, spec-clean way to express it without embedding HTML or inventing syntax. __x__ collides with CommonMark strong/bold and corrupts portability, so shipping it would break the plain-markdown principle.

_Source: SPEC §5.3, §5.2_
