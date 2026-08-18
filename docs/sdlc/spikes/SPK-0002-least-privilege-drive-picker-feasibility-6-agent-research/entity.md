---
id: SPK-0002
title: Least-privilege Drive picker feasibility (6-agent research pass)
status: answered
relations:
  implements:
    - REQ-0059
opened: 2026-08-17
question: How can szmde open a user's pre-existing .md files under the non-restricted drive.file scope from a Tauri custom-scheme WebView, given the classic web Picker's origin/CSP/embedded-webview blockers?
---
drive.file is the only non-restricted Drive scope and grants access only to app-created or Picker-selected files, so a Picker is mandatory (an in-app files.list browser is rejected — it can't enumerate pre-existing files). The classic web Picker fails in Tauri: custom-scheme origin (https://tauri.localhost) isn't a registerable Google JS origin, setOrigin rejects it, prod CSP script-src 'self' blocks apis.google.com/js/api.js, and Google blocks OAuth in embedded webviews (disallowed_useragent 403). Unlock: Google's system-browser desktop Picker (trigger_onepick) runs entirely in the system browser as an extension of the OAuth consent screen — nothing loads in the WebView, no CSP/origin/dev-key change, no token in page JS (response_type=code; tokens minted in Rust, only picked_file_ids on the redirect). Approach A (desktop Picker over existing loopback) chosen; B (local-server web Picker) fallback; C rejected.

_Source: docs/gdrive-picker-plan.md_
