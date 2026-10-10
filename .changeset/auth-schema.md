---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
'@aiontheballot/api': patch
'@aiontheballot/web': patch
'@aiontheballot/admin': patch
---

Better Auth's tables, in the `auth` schema that only `aiontheballot_auth` reaches (migration `auth_schema`,
ADR-0002 §2), and `createAuthPool` for its connections. Nothing signs in yet.
