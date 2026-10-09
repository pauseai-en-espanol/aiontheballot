---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add published revisions: `assessment_revisions`, `revision_evidence`, `revision_checked_documents`, the private
`revision_internal` and the `current_revisions` view. All immutable; publishers insert only the cell and the version
reviewed; the public reads revisions of live and archived elections of active tenants and the sources they cite.
