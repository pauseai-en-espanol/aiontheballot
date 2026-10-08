---
'@ballot/ui': minor
'@ballot/web': minor
'@ballot/admin': minor
'@ballot/i18n': minor
'@ballot/domain': patch
'@ballot/api': patch
---

Add the shared Panda preset (@ballot/ui) and the public and admin Next.js skeletons: a translated placeholder page,
an unlogged /healthz, zoom left enabled, and no cookies or X-Powered-By on the public app. Add the "coming soon"
message. Build packages without composite/incremental output so a JSON-only change can never leave stale
declarations.
