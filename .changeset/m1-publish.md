---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add publishing: `private.publish_revision()`, the trigger behind `INSERT INTO app.assessment_revisions
(assessment_id, reviewed_version)`. It checks the publisher, four-eyes, the election and freeze window, the change kind
and note, re-runs the verbatim match and the evidence requirement, copies the reviewed draft and starts the next
generation.
