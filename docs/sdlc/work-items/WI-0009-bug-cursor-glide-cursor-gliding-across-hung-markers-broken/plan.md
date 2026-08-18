# Plan

- [x] Bake the offset into the DECORATION (inline margin-left:-<canvas-measured width>) so CM re-applies it on every render -> marker always placed, caret glides consistently. Removed the measure plugin; trailing space is a separate in-flow token. Added cursor-glide contract tests (markers.dom.test.ts) across all 3 modes. Verified live. (M4 round 3.)
