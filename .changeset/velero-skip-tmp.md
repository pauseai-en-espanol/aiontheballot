---
'@aiontheballot/api': patch
'@aiontheballot/web': patch
'@aiontheballot/admin': patch
---

The pods tell Velero's file-system backup to skip their scratch volumes: of the API's, only the file volume is copied.
