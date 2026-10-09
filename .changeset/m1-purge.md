---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add `private.purge_tenant()`, executable only by the owner: it deletes every row of a tenant (published history and
audit rows included), keeps its hostnames as tombstones and records the purge in `purge_log`.
