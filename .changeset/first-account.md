---
'@aiontheballot/api': minor
'@aiontheballot/admin': minor
'@aiontheballot/i18n': minor
'@aiontheballot/observability': patch
'@aiontheballot/web': patch
'@aiontheballot/e2e': minor
---

The first account (PLAN R93): `node dist/create-account.js`, run in an API pod, asks for an email and a name, creates
a verified account and prints a single-use, one-hour link to the admin's new set-password page (its token in the
fragment, kept hashed), plus the SQL that makes it a platform admin once its person has enrolled TOTP. The API accepts
that token at /api/auth/reset-password, and setting a password ends the account's sessions. Error reports also drop
the query and fragment of URL-like context fields and tags.
