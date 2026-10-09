---
'@aiontheballot/ui': minor
'@aiontheballot/web': minor
'@aiontheballot/admin': minor
'@aiontheballot/i18n': minor
'@aiontheballot/domain': patch
'@aiontheballot/api': patch
---

Add the shared Panda preset (@aiontheballot/ui) and the public and admin Next.js skeletons: a translated placeholder page,
an unlogged /healthz, zoom left enabled, and no cookies or X-Powered-By on the public app. Add the "coming soon"
message. Build packages without composite/incremental output so a JSON-only change can never leave stale
declarations.
