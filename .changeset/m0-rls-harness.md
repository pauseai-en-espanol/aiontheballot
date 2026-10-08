---
'@ballot/db': patch
---

Add the tenant-isolation matrix harness: principals from ADR-0002, a runner that refuses to pass on a missing target,
a deny that changed data, or an allow touching more than one row, and a completeness test against the `app` schema.
