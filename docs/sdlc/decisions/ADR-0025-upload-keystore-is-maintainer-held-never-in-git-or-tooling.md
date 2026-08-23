---
id: ADR-0025
title: Upload keystore is maintainer-held, never in git or tooling
status: accepted
opened: 2026-08-17
---
**Choice:** The upload keystore + password are maintainer-generated and held, never committed or handled by tooling. build.gradle.kts loads gen/android/keystore.properties (git-ignored) only if it exists (absent → unsigned build, present → signed); in CI the workflow writes it from three repo secrets (ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD / ANDROID_KEY_BASE64). Absent secrets → the release job warns and builds unsigned. keystore.properties and the ANDROID_KEY_* names are fixed by convention.

**Why:** Dry-runs work before the keystore exists and local debug workflows are unaffected. The same cert's SHA-256 also feeds S6's assetlinks.json (App Links) and the Android OAuth client, so losing it churns new-cert everywhere — back it up.

_Source: docs/ci-cd.md_
