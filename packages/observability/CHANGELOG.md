# @aiontheballot/observability

## 0.2.1

### Patch Changes

- 94c11b3: The public site loads each tenant's Plausible script from its own host and relays the script's events
  (`/_relay/views.js`, `/_relay/views`; PLAN R83): every Plausible feature, no request to another host, no cookie. It
  counts nothing until the deployment sets `PLAUSIBLE_URL` and `PLAUSIBLE_SITES`.

## 0.2.0

### Minor Changes

- 9504ee9: Report errors to GlitchTip (ADR-0003 §7). The API and the Next servers send to its in-cluster Service when
  SENTRY_DSN is set. Browsers send through /_relay/errors on the app's own host, which forwards only to that app's
  project with the DSN held server-side. The public site loads its browser SDK only on the first error. No personal data
  leaves the apps: data collection is off and every event is scrubbed (no user, no query strings, emails redacted). The
  i18n catalogue can be imported without the message formatter, and both apps get a root error page.
