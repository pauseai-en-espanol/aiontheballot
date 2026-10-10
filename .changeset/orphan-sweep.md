---
'@aiontheballot/db': minor
'@aiontheballot/api': minor
---

The orphan-bytes sweep (ADR-0004 §5): `node dist/sweep-files.js` reads the owner's list of every file row, brand asset
and deleted file (`--print-query` prints the query) and, with `--delete`, deletes bytes no row has named for longer
than the grace period (120 days, never less than 111), never ones stored or reused within a day of the list.
