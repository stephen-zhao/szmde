---
id: ADR-0029
title: Google = Desktop-app client; OneDrive = multitenant + 'common' tenant
status: accepted
opened: 2026-08-17
---
**Choice:** Google Drive: create a Desktop-app OAuth client (not Web application) — loopback http://127.0.0.1:<port> handled automatically, PKCE (not the issued client secret) provides security, so the 'client secret' is not treated as confidential. Microsoft/OneDrive: register multitenant + personal accounts, add a Public-client/native redirect http://localhost, request Files.ReadWrite + offline_access + User.Read, and sign in against the special `common` tenant (not the specific Directory/tenant GUID).

**Why:** Desktop-app is the correct installed-app type for the PKCE loopback flow (no redirect registration); `common` admits both personal and work/school accounts, and consumer OneDrive requires personal accounts to be allowed; offline_access is required or sync silently stops after ~1 hour.

_Source: docs/m3-cloud-setup.md_
