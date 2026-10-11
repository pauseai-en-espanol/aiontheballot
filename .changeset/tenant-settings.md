---
'@aiontheballot/api': minor
'@aiontheballot/admin': minor
'@aiontheballot/i18n': minor
'@aiontheballot/e2e': minor
---

Tenant settings and policy texts (editorial workflow §5, P1; PLAN R99, R100). A site's settings screen shows everyone
how long reports are kept and whether live changes need a second approver; country admins change the first and
platform admins the second. Country admins write the privacy policy, the right-of-reply policy and the text about the
operator per language, as drafts they save, publish after a confirmation or delete; published versions never change.
New API routes: `PATCH /api/t/:tenant/settings`, `GET` and `POST /api/t/:tenant/documents`, and `PATCH` and `DELETE
/api/t/:tenant/documents/:id`.
