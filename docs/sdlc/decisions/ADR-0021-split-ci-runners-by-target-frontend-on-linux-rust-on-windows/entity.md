---
id: ADR-0021
title: 'Split CI runners by target: frontend on Linux, Rust on Windows'
status: accepted
opened: 2026-08-17
---
**Choice:** The frontend gate runs on ubuntu-latest; the Rust job runs on windows-latest.

**Why:** Rust runs on Windows because that is the release target (WebView2 preinstalled); the frontend tests are platform-agnostic and Linux is faster.

_Source: docs/ci-cd.md_
