---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add right-of-reply reports: `app.submit_report()` (the public's only write, with a per-tenant daily cap), triage by
members (never platform admins), anonymization on request or by the worker's daily
`private.anonymize_expired_reports()`, and personal-data columns kept out of the audit log.
