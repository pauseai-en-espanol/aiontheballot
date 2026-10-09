---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add cells: `assessments`, `assessment_contributors`, `draft_evidence`, `draft_checked_documents` and `review_events`.
Editors and country admins write draft content; reviewers change only the state and attest quotes; every member
reads. Also fix `app.localized`, whose check refused SQL NULL, so nullable localized columns can use it.
