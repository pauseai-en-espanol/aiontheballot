---
'@aiontheballot/api': minor
'@aiontheballot/web': minor
'@aiontheballot/e2e': minor
---

Route the public site by host: the web app's `proxy.ts` runs `resolve()` with routing data from the API's new
`GET /public/routing` (read as `aiontheballot_web`), rewriting tenant pages to their internal path, redirecting aliases
and platform paths, and answering 404 to everything else. The e2e stack runs on a migrated, seeded database and tests
status codes, `Location`, a spoofed `X-Forwarded-Host`, the internal prefix and the absence of cookies.
