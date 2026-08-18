---
id: ADR-0009
title: 'Least-privilege Google Drive: drive.file scope + system-browser Picker'
status: accepted
relations:
  informed_by:
    - SPK-0001
    - SPK-0002
opened: 2026-08-17
---
**Choice:** Use the non-sensitive drive.file scope and open pre-existing files via Google's system-browser Picker (trigger_onepick), which also doubles as sign-in. Nothing Google-related loads in the WebView (no CSP change, no authorized JS origin, no token in page JS). OAuth loopback + PKCE, Host-header allowlisted; tokens in the OS secure store. Do NOT reintroduce the full 'drive' scope or an in-WebView Picker.

**Why:** The full drive scope is restricted, triggering Google verification and an unverified-app warning. drive.file plus the Picker grant per-file access without either. Keeping Google out of the WebView avoids CSP/origin exposure and DNS-rebinding attack surface.

_Source: SPEC §6, §2.2; CLAUDE.md 'Storage seam'_
