---
'@aiontheballot/migrations': patch
'@aiontheballot/db': patch
'@aiontheballot/api': patch
---

Better Auth gets its own database role, `aiontheballot_auth` (ADR-0002 §2), created locally and in CI and kept
out of `app` and `private` by the catalog tests. Nothing uses it yet.
