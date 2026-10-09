---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add tenancy: `tenants`, `platform_admins` and `memberships` with RLS, and the policy helpers `private.my_tenants()`
and `private.is_platform_admin()` (aal2 only). The admin shows each user only what is theirs; public-visibility
policies are for `aiontheballot_web` only. Country admins change only their tenant's theme, report retention and LLM
cap. The isolation matrix now generates its cases from per-table rules and runs them against shared fixtures.
