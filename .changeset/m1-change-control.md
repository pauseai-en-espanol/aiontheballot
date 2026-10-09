---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add change control for live elections: `change_requests`, the public `structural_changes` and the `corrections_log`
view. A live election's structure changes only through a request approved in the same transaction, applied by the
approver, with a second approver when the tenant requires one and no approvals in the freeze window.
