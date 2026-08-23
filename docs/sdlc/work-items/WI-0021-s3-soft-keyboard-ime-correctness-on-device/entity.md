---
id: WI-0021
title: S3 — Soft-keyboard + IME correctness (on-device)
status: done
relations:
  parent: EPIC-0009
  implements:
    - REQ-0085
    - REQ-0066
opened: 2026-08-17
---
Done 2026-07-20. The planned CSS-only route (interactive-widget=resizes-content + visualViewport) could not work as specced (risk #4), so shipped as a native IME-inset bridge in MainActivity.kt publishing --kb-inset, with CSS shrinking .app and lifting .statusbar. Verified on a physical Pixel 9 Pro: --kb-inset 373px, .app 952->579, statusbar 32->381px. Acceptance was only PARTLY met (caught by S3 adversarial review): the active line was overpainted by fixed status chips; that is REQ-SCROLL-1, which landed 2026-07-21 (commit e18a7a8, PR #19) putting the active line on a two-thirds typewriter anchor (editor.typewriterAnchor). Shipped behaviour is NOT centring (centring was rejected in phone user-testing).
