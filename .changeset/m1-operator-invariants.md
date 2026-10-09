---
'@aiontheballot/migrations': minor
---

Require exactly one operator for every active tenant: a deferred check when a tenant is created or made active, and
whenever an operator link is removed or demoted, so a tenant and its operator (or a new operator) can be set in one
transaction.
