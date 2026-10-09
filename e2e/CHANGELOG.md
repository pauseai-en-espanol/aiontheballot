# @aiontheballot/e2e

## 0.2.0

### Minor Changes

- 685914f: Route the public site by host: the web app's `proxy.ts` runs `resolve()` with routing data from the API's new
  `GET /public/routing` (read as `aiontheballot_web`), rewriting tenant pages to their internal path, redirecting aliases
  and platform paths, and answering 404 to everything else. The e2e stack runs on a migrated, seeded database and tests
  status codes, `Location`, a spoofed `X-Forwarded-Host`, the internal prefix and the absence of cookies.

### Patch Changes

- 7d03e3f: Send the web relay's request checks to the server's address: Node can't resolve `.localhost` names on the CI runner.

## 0.1.1

### Patch Changes

- 9504ee9: Report errors to GlitchTip (ADR-0003 §7). The API and the Next servers send to its in-cluster Service when
  SENTRY_DSN is set. Browsers send through /_relay/errors on the app's own host, which forwards only to that app's
  project with the DSN held server-side. The public site loads its browser SDK only on the first error. No personal data
  leaves the apps: data collection is off and every event is scrubbed (no user, no query strings, emails redacted). The
  i18n catalogue can be imported without the message formatter, and both apps get a root error page.

## 0.1.0

### Minor Changes

- c217473: Add Playwright smoke tests against production builds of web, admin and api: pages render, health probes answer, and
  the public site sets no cookies and keeps zoom enabled. Read the platform name at request time: the layouts were
  prerendered at build time, so every image would have shipped without a title.
