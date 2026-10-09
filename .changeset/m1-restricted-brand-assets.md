---
'@aiontheballot/migrations': minor
---

Restrict restricted brand assets to eligible tenants: a tenant may select one only if its operator is a PauseAI
chapter and the asset was granted to it, and an organization may use one as its logo only if it is a chapter. A
deferred check re-runs whenever any of those inputs changes.
