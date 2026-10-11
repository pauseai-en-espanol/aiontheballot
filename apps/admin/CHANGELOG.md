# @aiontheballot/admin

## 0.10.0

### Minor Changes

- 59950f5: The cell editor and the review workflow (PLAN R131): the election's cell grid, and each cell's page to draft a rating
  with quotes checked against their source as they are typed, record checked documents, submit, recall, publish, send
  back with a note, comment, clear a recheck flag and delete a cell never published, at the version loaded.
- 5c4e6b8: Invitations (PLAN R114): country admins invite someone by email with a role from the members page, revoke and delete
  invitations; the invited person follows the link, chooses a name and a password if they have no account, and the
  membership is theirs once they have set up their second factor.
- 91cfb5a: A party's programme status on the admin's party page (editorial workflow PS1, PLAN R128): a check records the status
  and its date, which the scorecard shows, in a live election too; "published" needs a source marked as the programme.
- 7bd93a4: The site's own signup list (PLAN R119, R122): double opt-in through three narrow database functions, a confirmation
  email through the platform's one sender (R115, R123), one-click unsubscribe, unconfirmed addresses deleted after 7
  days, and counts for country admins. The legal notice, privacy policy and page about the operator, served before the
  site opens (R124). Site modes (coming soon, open, preview) and a site's own words in its paths (R121).
- 5896c16: Sites on the platform's own screens (PLAN R129): platform admins list every site with its addresses, create one
  (off, with its operator) and turn it on or off. Demo content for a demo site (PLAN R130): a script prints the SQL
  that fills an empty, active site in a user-assigned country with an obviously fictional election.

### Patch Changes

- b869a83: The public site's election pages (PLAN R125): the scorecard, with a table on desktops and cards per party or per
  criterion on phones, and the party, criterion, cell and methodology pages, every cell able to show "pending", from a
  new public election route in the API. The fixed rating visuals. Security headers on every response (R126); per-site
  sitemaps and robots, and the page's language in `<html lang>` (R127).
- Updated dependencies [59950f5]
- Updated dependencies [5c4e6b8]
- Updated dependencies [91cfb5a]
- Updated dependencies [b869a83]
- Updated dependencies [4fc2f00]
- Updated dependencies [7bd93a4]
- Updated dependencies [5896c16]
  - @aiontheballot/i18n@0.13.0
  - @aiontheballot/domain@0.8.0

## 0.9.0

### Minor Changes

- 4572be4: Organizations on the platform's own screens (editorial workflow P2, PLAN R112): platform admins list every
  organization with the sites it serves, create one, and change its name, legal details, contact and privacy emails,
  links and whether it is a PauseAI chapter. Anyone else gets a 404.

### Patch Changes

- 7ba5873: Dependencies bump
- 285b124: Dependencies bump
- Updated dependencies [7ba5873]
- Updated dependencies [4572be4]
  - @aiontheballot/i18n@0.12.0
  - @aiontheballot/observability@0.2.3

## 0.8.0

### Minor Changes

- 88fbcfc: A language switch at the foot of every admin page (PLAN R108): English or Spanish, kept in a preference cookie on the
  admin host, over the browser's language, which still decides until someone chooses. With scripts, the page redraws in
  place and keeps what was typed. The accessibility check waits for a page redrawn after a save to get its title back.

### Patch Changes

- Updated dependencies [88fbcfc]
  - @aiontheballot/i18n@0.11.0

## 0.7.0

### Minor Changes

- 0ebe03a: Elections and their structure (editorial workflow §6, P1; PLAN R101–R106). Editors create elections as drafts and
  change them while they are; country admins announce and delete them, and write the methodology and its named external
  reviewers, take them live after a checklist and a typed confirmation, set their freeze window and archive them;
  platform admins turn four-eyes off after a confirmation. Editors add, order by keyboard, change and delete parties and
  criteria. Live and archived elections are shown read-only. Two migrations: `slug_length` (slugs stop at 63
  characters) and `report_retention_cap` (reports are kept a century at most). New API routes under
  `/api/t/:tenant/elections` and `/api/t/:tenant/e/:election`, with its `checklist`, `methodology`,
  `methodology/reviewers`, `parties` and `criteria`.

### Patch Changes

- Updated dependencies [0ebe03a]
  - @aiontheballot/i18n@0.10.0

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
