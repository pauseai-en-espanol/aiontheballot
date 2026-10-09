---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add the public cache key: `app.public_versions`, one counter per tenant that the public reads (active tenants only)
and that only the `SECURITY DEFINER` trigger `private.bump_public_version()` moves, on every write to a table the
public can read. No runtime role can set or rewind it.
