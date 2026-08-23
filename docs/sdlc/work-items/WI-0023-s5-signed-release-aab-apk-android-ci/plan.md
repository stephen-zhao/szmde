# Plan

- [x] Signed release AAB/APK + Android CI — core landed
- [ ] Maintainer generates the upload keystore
- [ ] Maintainer sets the three repo secrets (keeps both certs — the cert SHA-256 feeds S6's assetlinks.json)
- [ ] A workflow_dispatch dry-run goes green
- [ ] The signed APK installs on a device
