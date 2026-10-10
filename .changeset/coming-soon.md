---
'@aiontheballot/ui': minor
'@aiontheballot/domain': minor
'@aiontheballot/i18n': minor
'@aiontheballot/db': patch
'@aiontheballot/api': minor
'@aiontheballot/web': minor
'@aiontheballot/e2e': minor
---

A tenant's home is now its coming-soon page, in PauseAI's brand: the tenant's name, what the site will do, the next
public election and the operator's links, all from data, in Spanish and English, on a desktop and a phone. The API
serves it at `GET /public/tenants/{slug}/home` (read as `aiontheballot_web`); the web app caches each tenant's copy
and keeps it when the API fails. The shared preset gains the brand colours as semantic tokens, contrast-tested, and
the self-hosted fonts. The e2e suite checks the page with axe at both sizes.
