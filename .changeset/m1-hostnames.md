---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add hostnames: `platform_hostnames`, `tenant_hostnames`, `hostname_tombstones` and `hostname_verifications`, with the
`app.hostname` domain (the form `resolve()` normalizes to). Only platform admins write them; hostnames are never
deleted, renamed or moved; reserved and tombstoned names can't be claimed; at most one canonical hostname per tenant,
verified and not retired. The public reads verified hostnames of active tenants and all tombstones.
