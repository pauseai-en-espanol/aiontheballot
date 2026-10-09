---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add the audit log: `app.audit_log`, immutable, and the `private.audit()` trigger on every table, which records each
write with its tenant, actor, key and diff and never copies columns commented `personal data`. Country admins read
their tenant's entries; platform admins read all of them.
