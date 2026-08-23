---
id: SPK-0003
title: Drive picker grant persistence + .md MIME behavior (WF-28)
status: open
relations:
  implements:
    - REQ-0059
opened: 2026-08-17
question: Does a drive.file per-file grant + stored refresh token let a previously-picked file re-open in later sessions without re-picking? And does Drive surface .md files given szmde ships NO mimetypes filter (Drive may report .md as application/octet-stream)?
---
Folded into S7 live verification WF-28 (user-run in the dev app), still pending — not resolved by the S1 spike. Open risk #4 (grant persistence) and #6 (.md MIME) remain to confirm live; the design ships no mimetypes filter to avoid hiding .md. Related open risks #5 (refresh-token rotation under repeated prompt=consent → invalid_grant) and #7 (one-time scope-migration UX) also await live confirmation. Plan header marks the feature BUILT (S1-S6 done, S4 skipped) with S7/WF-28 the remaining slice.

_Source: docs/gdrive-picker-plan.md_
