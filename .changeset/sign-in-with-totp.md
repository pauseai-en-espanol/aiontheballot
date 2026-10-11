---
'@aiontheballot/api': minor
'@aiontheballot/admin': minor
'@aiontheballot/migrations': minor
'@aiontheballot/i18n': minor
'@aiontheballot/web': patch
'@aiontheballot/e2e': minor
---

Sign in to the admin with a password and a TOTP code (PLAN R84–R92). The API mounts Better Auth's sign-in,
enrolment and challenge endpoints under /api/auth on the admin host only, records per session whether a second factor
opened it (migration auth_session_aal), acts at aal2 only for those sessions, and lists a signed-in user's tenants. A
daily CronJob deletes expired sessions. The admin gets its sign-in, TOTP enrolment and challenge screens in English and
Spanish.
