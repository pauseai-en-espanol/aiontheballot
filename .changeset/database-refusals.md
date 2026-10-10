---
'@aiontheballot/api': minor
'@aiontheballot/i18n': minor
'@aiontheballot/web': patch
---

The admin API's answer to a database refusal (editorial workflow §2.3): its SQLSTATE becomes the HTTP status and a
message key, in English and Spanish, never the database's own message.
