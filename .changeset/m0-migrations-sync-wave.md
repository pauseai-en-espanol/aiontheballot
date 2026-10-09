---
'@aiontheballot/migrations': patch
---

Run the migration Job as an Argo CD Sync hook in wave -1 instead of PreSync, so on a first sync it runs after the gitops
Secrets and the Harbor pull secret exist, and still before the new pods roll out.
