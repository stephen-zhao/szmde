---
id: ADR-0028
title: One Android OAuth client per signing cert; Android is a public (PKCE)…
status: accepted
relations:
  informed_by:
    - SPK-0005
opened: 2026-08-17
---
**Choice:** Create one Android OAuth client per signing cert — a debug client (package com.zhaostephen.szmde + debug SHA-1) for testing now, a second release client (release SHA-1, custom-URI-scheme on, its scheme added to the manifest) at shipping. Android uses an empty client_secret (public client, pure PKCE), so gdrive_client.json differs per build.

**Why:** An OAuth client is keyed to a (package, SHA-1) pair, so debug and release certs need separate clients, ids, and manifest schemes.

_Source: docs/android-signin-setup.md_
