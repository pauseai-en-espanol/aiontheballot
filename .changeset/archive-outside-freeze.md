---
'@aiontheballot/migrations': minor
'@aiontheballot/db': patch
---

No archiving inside a freeze window (PLAN R109, D11): an election goes from live to archived only once its freeze
window is over or cleared, so an archived election's corrections can't stay frozen for good.
