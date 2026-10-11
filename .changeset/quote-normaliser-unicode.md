---
'@aiontheballot/migrations': patch
'@aiontheballot/domain': patch
---

The quote normalisers follow Unicode's rules on both sides (PLAN R113): letters and spaces are Unicode's Alphabetic
and White_Space, the database's under `pg_c_utf8`, and a byte-order mark is dropped. The migration stops if any stored
text would normalise differently.
