---
'@aiontheballot/api': minor
'@aiontheballot/admin': minor
'@aiontheballot/i18n': minor
'@aiontheballot/migrations': minor
'@aiontheballot/db': patch
'@aiontheballot/e2e': minor
---

Elections and their structure (editorial workflow §6, P1; PLAN R101–R106). Editors create elections as drafts and
change them while they are; country admins announce and delete them, and write the methodology and its named external
reviewers, take them live after a checklist and a typed confirmation, set their freeze window and archive them;
platform admins turn four-eyes off after a confirmation. Editors add, order by keyboard, change and delete parties and
criteria. Live and archived elections are shown read-only. Two migrations: `slug_length` (slugs stop at 63
characters) and `report_retention_cap` (reports are kept a century at most). New API routes under
`/api/t/:tenant/elections` and `/api/t/:tenant/e/:election`, with its `checklist`, `methodology`,
`methodology/reviewers`, `parties` and `criteria`.
