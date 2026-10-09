---
'@aiontheballot/domain': minor
---

Add public-site routing (ADR-0002): `resolve()` picks the tenant from the Host header and serves, 301s to the
canonical base or 404s, never falling back to a default tenant; `canonicalBase()`; and a routing table that re-checks
the hostname invariants. It also parses the locale prefix and reserves `_` paths, so the internal prefix can't be
requested.
