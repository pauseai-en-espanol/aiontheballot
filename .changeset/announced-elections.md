---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
'@aiontheballot/e2e': minor
---

A country admin may announce a draft election (migration `announced_elections`), so a tenant's coming-soon page names
it and gives its date before it goes live. The public sees the announced election's own row and nothing under it.
ADR-0002's public-visibility rule is amended accordingly (PLAN R51).
