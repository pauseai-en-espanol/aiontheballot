# @aiontheballot/admin

## 0.6.0

### Minor Changes

- ed8f815: Tenant settings and policy texts (editorial workflow §5, P1; PLAN R99, R100). A site's settings screen shows everyone
  how long reports are kept and whether live changes need a second approver; country admins change the first and
  platform admins the second. Country admins write the privacy policy, the right-of-reply policy and the text about the
  operator per language, as drafts they save, publish after a confirmation or delete; published versions never change.
  New API routes: `PATCH /api/t/:tenant/settings`, `GET` and `POST /api/t/:tenant/documents`, and `PATCH` and `DELETE
/api/t/:tenant/documents/:id`.

### Patch Changes

- Updated dependencies [ed8f815]
  - @aiontheballot/i18n@0.9.0

## 0.5.0

### Minor Changes

- b0342af: Choosing a site and managing its members (editorial workflow A6, A7; PLAN R94–R98). After sign-in, a member of one
  site lands on its dashboard and anyone else on the site list; every site screen has a shell with a site switcher and
  its sections. The members screen shows everyone's names and roles, emails only to country and platform admins, and lets
  them remove a role (never the site's last country admin) or give a member another. New API routes: `GET /api/t/:tenant`,
  `GET /api/t/:tenant/members`, `POST /api/t/:tenant/members/:userId/roles` and
  `DELETE /api/t/:tenant/members/:userId/roles/:role`; `GET /api/tenants` also says whether the user is a platform admin.

### Patch Changes

- Updated dependencies [b0342af]
  - @aiontheballot/i18n@0.8.0

## 0.4.0

### Minor Changes

- 47da044: The first account (PLAN R93): `node dist/create-account.js`, run in an API pod, asks for an email and a name, creates
  a verified account and prints a single-use, one-hour link to the admin's new set-password page (its token in the
  fragment, kept hashed), plus the SQL that makes it a platform admin once its person has enrolled TOTP. The API accepts
  that token at /api/auth/reset-password, and setting a password ends the account's sessions. Error reports also drop
  the query and fragment of URL-like context fields and tags.

### Patch Changes

- Updated dependencies [47da044]
  - @aiontheballot/i18n@0.7.0
  - @aiontheballot/observability@0.2.2

## 0.3.0

### Minor Changes

- 83e9248: Sign in to the admin with a password and a TOTP code (PLAN R84–R92). The API mounts Better Auth's sign-in,
  enrolment and challenge endpoints under /api/auth on the admin host only, records per session whether a second factor
  opened it (migration auth_session_aal), acts at aal2 only for those sessions, and lists a signed-in user's tenants. A
  daily CronJob deletes expired sessions. The admin gets its sign-in, TOTP enrolment and challenge screens in English and
  Spanish.

### Patch Changes

- 1756b0e: CI passes the sign-in tests' database URLs through Turbo (TEST_ADMIN_DATABASE_URL for the API's database tests; the
  auth, admin and owner URLs for the end-to-end tests), which locally came from .env.
- Updated dependencies [83e9248]
  - @aiontheballot/i18n@0.6.0

## 0.2.8

### Patch Changes

- Updated dependencies [94c11b3]
- Updated dependencies [874daf8]
  - @aiontheballot/observability@0.2.1
  - @aiontheballot/i18n@0.5.1

## 0.2.7

### Patch Changes

- 4f5e76a: Better Auth's tables, in the `auth` schema that only `aiontheballot_auth` reaches (migration `auth_schema`,
  ADR-0002 §2), and `createAuthPool` for its connections. Nothing signs in yet.

## 0.2.6

### Patch Changes

- 07fb157: The pods tell Velero's file-system backup to skip their scratch volumes: of the API's, only the file volume is copied.
- Updated dependencies [01a9f7f]
  - @aiontheballot/i18n@0.5.0

## 0.2.5

### Patch Changes

- a2cea6d: File bytes move from Postgres to a persistent volume (migration `files_on_volume`, ADR-0004): the API mounts a
  `local-path` volume of type `local` at `/data` and reads each file's bytes from its row's own tenant and bucket, only
  for a row RLS shows, checking the hash on every read. `file_blobs` and the brand assets' inline bytes are gone; the
  migration refuses to run while any bytes are stored in the database. `node dist/put-file.js <tenant-id> <bucket>`
  puts bytes on the volume from stdin until the admin can upload them, and `node dist/purge-tenant-files.js` deletes a
  purged tenant's folder, given proof of the purge. Web and admin are rebuilt only because turbo.json changed.

## 0.2.4

### Patch Changes

- Updated dependencies [2a30cfe]
  - @aiontheballot/i18n@0.4.0

## 0.2.3

### Patch Changes

- Updated dependencies [1f4eabe]
  - @aiontheballot/i18n@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [2f43760]
- Updated dependencies [d167b29]
  - @aiontheballot/i18n@0.2.0

## 0.2.1

### Patch Changes

- 7a6d8c4: Run on Node 26.11.1: the base images (pinned by digest) and the engines range.

## 0.2.0

### Minor Changes

- 9504ee9: Report errors to GlitchTip (ADR-0003 §7). The API and the Next servers send to its in-cluster Service when
  SENTRY_DSN is set. Browsers send through /_relay/errors on the app's own host, which forwards only to that app's
  project with the DSN held server-side. The public site loads its browser SDK only on the first error. No personal data
  leaves the apps: data collection is off and every event is scrubbed (no user, no query strings, emails redacted). The
  i18n catalogue can be imported without the message formatter, and both apps get a root error page.

### Patch Changes

- Updated dependencies [9504ee9]
  - @aiontheballot/observability@0.2.0
  - @aiontheballot/i18n@0.1.1

## 0.1.0

### Minor Changes

- 6ed9131: Ship Docker images: web, admin and api built with turbo prune (manifest-only install layer), running as non-root, and
  a migrations image (dbmate plus the migrations) for the chart's PreSync Job. The Next apps run panda codegen as part of
  their build, so builds no longer depend on install-time hooks.
- 85ada24: Add the shared Panda preset (@aiontheballot/ui) and the public and admin Next.js skeletons: a translated placeholder page,
  an unlogged /healthz, zoom left enabled, and no cookies or X-Powered-By on the public app. Add the "coming soon"
  message. Build packages without composite/incremental output so a JSON-only change can never leave stale
  declarations.

### Patch Changes

- c217473: Add Playwright smoke tests against production builds of web, admin and api: pages render, health probes answer, and
  the public site sets no cookies and keeps zoom enabled. Read the platform name at request time: the layouts were
  prerendered at build time, so every image would have shipped without a title.
- 8a9f648: Add the Helm charts: a subchart per deployable and the `aiontheballot` umbrella chart (migrations as an Argo CD PreSync Job,
  routes for the public and admin hosts, restrictive security contexts and resource limits).
- e13c986: Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
  and the i18n JSON include they required, and write the Vitest configs in TypeScript.
- Updated dependencies [6e85ec0]
- Updated dependencies [e13c986]
- Updated dependencies [85ada24]
  - @aiontheballot/i18n@0.1.0
