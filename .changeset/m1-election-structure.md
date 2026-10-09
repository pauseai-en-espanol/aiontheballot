---
'@aiontheballot/migrations': minor
---

Add an election's structure: `core_criteria`, `elections`, `methodologies`, `methodology_reviewers`, `parties` and
`criteria`. Editors and country admins write elections, parties and criteria; country admins set status and the freeze
window and write the methodology and its external reviewers; only platform admins change four-eyes review. New
elections start as drafts; structure is deleted only in drafts. The public reads live and archived elections of active
tenants, and the images their parties show as logos.
