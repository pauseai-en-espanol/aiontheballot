---
'@aiontheballot/observability': minor
'@aiontheballot/web': minor
'@aiontheballot/admin': minor
'@aiontheballot/api': minor
'@aiontheballot/i18n': patch
'@aiontheballot/e2e': patch
---

Report errors to GlitchTip (ADR-0003 §7). The API and the Next servers send to its in-cluster Service when
SENTRY_DSN is set. Browsers send through /_relay/errors on the app's own host, which forwards only to that app's
project with the DSN held server-side. The public site loads its browser SDK only on the first error. No personal data
leaves the apps: data collection is off and every event is scrubbed (no user, no query strings, emails redacted). The
i18n catalogue can be imported without the message formatter, and both apps get a root error page.
