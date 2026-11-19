---
'@aiontheballot/migrations': minor
'@aiontheballot/api': minor
'@aiontheballot/admin': minor
'@aiontheballot/db': minor
'@aiontheballot/domain': minor
'@aiontheballot/i18n': patch
---

A platform admin can change a published cell of a live election off the record: the change takes no change kind and
no public note, stays out of the corrections log, and the public reads it in the place of the revision before it.
The admin keeps the revision, marked, with who published it.
