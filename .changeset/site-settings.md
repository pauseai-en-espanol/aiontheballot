---
'@aiontheballot/migrations': minor
'@aiontheballot/api': minor
'@aiontheballot/web': minor
'@aiontheballot/admin': minor
'@aiontheballot/domain': minor
'@aiontheballot/i18n': minor
'@aiontheballot/db': minor
'@aiontheballot/e2e': minor
---

A site's public settings are data (PLAN R135): whether it is open, whether search engines may index it, and its
Plausible script are switches on the site's admin page, for platform admins, instead of `OPEN_SITES` and
`PLAUSIBLE_SITES` in the web app's environment. A site kept out of search engines answers `noindex, nofollow`
everywhere, disallows everything in its robots.txt and has no sitemap, for a demo's fictional content.
