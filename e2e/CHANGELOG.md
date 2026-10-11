# @aiontheballot/e2e

## 0.13.0

### Minor Changes

- 0ebe03a: Elections and their structure (editorial workflow §6, P1; PLAN R101–R106). Editors create elections as drafts and
  change them while they are; country admins announce and delete them, and write the methodology and its named external
  reviewers, take them live after a checklist and a typed confirmation, set their freeze window and archive them;
  platform admins turn four-eyes off after a confirmation. Editors add, order by keyboard, change and delete parties and
  criteria. Live and archived elections are shown read-only. Two migrations: `slug_length` (slugs stop at 63
  characters) and `report_retention_cap` (reports are kept a century at most). New API routes under
  `/api/t/:tenant/elections` and `/api/t/:tenant/e/:election`, with its `checklist`, `methodology`,
  `methodology/reviewers`, `parties` and `criteria`.

## 0.12.0

### Minor Changes

- ed8f815: Tenant settings and policy texts (editorial workflow §5, P1; PLAN R99, R100). A site's settings screen shows everyone
  how long reports are kept and whether live changes need a second approver; country admins change the first and
  platform admins the second. Country admins write the privacy policy, the right-of-reply policy and the text about the
  operator per language, as drafts they save, publish after a confirmation or delete; published versions never change.
  New API routes: `PATCH /api/t/:tenant/settings`, `GET` and `POST /api/t/:tenant/documents`, and `PATCH` and `DELETE
/api/t/:tenant/documents/:id`.

## 0.11.0

### Minor Changes

- b0342af: Choosing a site and managing its members (editorial workflow A6, A7; PLAN R94–R98). After sign-in, a member of one
  site lands on its dashboard and anyone else on the site list; every site screen has a shell with a site switcher and
  its sections. The members screen shows everyone's names and roles, emails only to country and platform admins, and lets
  them remove a role (never the site's last country admin) or give a member another. New API routes: `GET /api/t/:tenant`,
  `GET /api/t/:tenant/members`, `POST /api/t/:tenant/members/:userId/roles` and
  `DELETE /api/t/:tenant/members/:userId/roles/:role`; `GET /api/tenants` also says whether the user is a platform admin.

## 0.10.0

### Minor Changes

- 47da044: The first account (PLAN R93): `node dist/create-account.js`, run in an API pod, asks for an email and a name, creates
  a verified account and prints a single-use, one-hour link to the admin's new set-password page (its token in the
  fragment, kept hashed), plus the SQL that makes it a platform admin once its person has enrolled TOTP. The API accepts
  that token at /api/auth/reset-password, and setting a password ends the account's sessions. Error reports also drop
  the query and fragment of URL-like context fields and tags.

## 0.9.0

### Minor Changes

- 83e9248: Sign in to the admin with a password and a TOTP code (PLAN R84–R92). The API mounts Better Auth's sign-in,
  enrolment and challenge endpoints under /api/auth on the admin host only, records per session whether a second factor
  opened it (migration auth_session_aal), acts at aal2 only for those sessions, and lists a signed-in user's tenants. A
  daily CronJob deletes expired sessions. The admin gets its sign-in, TOTP enrolment and challenge screens in English and
  Spanish.

## 0.8.1

### Patch Changes

- 94c11b3: The public site loads each tenant's Plausible script from its own host and relays the script's events
  (`/_relay/views.js`, `/_relay/views`; PLAN R83): every Plausible feature, no request to another host, no cookie. It
  counts nothing until the deployment sets `PLAUSIBLE_URL` and `PLAUSIBLE_SITES`.
- 874daf8: The coming-soon page gives the next election's date in full on a line of its own ("Domingo, 29 de noviembre de 2026"),
  says "Una iniciativa de" once, in the footer, and no longer offers the operator's newsletter as "Avísame cuando se
  publique" (PLAN R82). The translator formats dates in UTC, so an election's date never moves a day with the server's
  time zone.

## 0.8.0

### Minor Changes

- bc2fe41: A country admin may announce a draft election (migration `announced_elections`), so a tenant's coming-soon page names
  it and gives its date before it goes live. The public sees the announced election's own row and nothing under it.
  ADR-0002's public-visibility rule is amended accordingly (PLAN R51).

## 0.7.0

### Minor Changes

- 7f83fd8: Site icons: the platform's default (the coming-soon ballot, marked with the AI sparkle, on an orange tile), or a
  tenant's own square PNG from its new `site_icon` logo slot (a whole PNG, 512 to 1,024 px). Pages name the icons by
  content hash at `/brand/icon/{size}.{hash}.png`, cached as immutable, with `/favicon.ico` and a web manifest. The
  seeds give `ejemplo-a` a fictional icon.

## 0.6.0

### Minor Changes

- a2cea6d: File bytes move from Postgres to a persistent volume (migration `files_on_volume`, ADR-0004): the API mounts a
  `local-path` volume of type `local` at `/data` and reads each file's bytes from its row's own tenant and bucket, only
  for a row RLS shows, checking the hash on every read. `file_blobs` and the brand assets' inline bytes are gone; the
  migration refuses to run while any bytes are stored in the database. `node dist/put-file.js <tenant-id> <bucket>`
  puts bytes on the volume from stdin until the admin can upload them, and `node dist/purge-tenant-files.js` deletes a
  purged tenant's folder, given proof of the purge. Web and admin are rebuilt only because turbo.json changed.

## 0.5.0

### Minor Changes

- 1f4eabe: Tenants' own logos (migration `tenant_brand_uploads`): a brand selection can name one of the tenant's uploaded
  images, public while an active tenant selects it. The API serves the home data's brand images by hash; the web app
  shows the operator's logo in the coming-soon page's header and footer, at `/brand/{sha256}.{ext}` cached as immutable,
  and draws it on the share cards.

## 0.4.0

### Minor Changes

- 0bcb112: Link previews for the coming-soon page: Open Graph and Twitter tags, the canonical address and `hreflang` from the
  routing table, and share images in the four sizes from the new `packages/og` (satori, then resvg, fonts embedded),
  served from content-hash URLs cached as immutable, with 304s. Images are pre-rendered while their page renders and
  when a server starts. The hero's name is sized by the viewport's height too.

### Patch Changes

- 0504b2c: The share tests fetch by Host header on 127.0.0.1, so they pass on Linux runners, which can't resolve `*.localhost`.

## 0.3.0

### Minor Changes

- 2f43760: A tenant's home is now its coming-soon page, in PauseAI's brand: the tenant's name, what the site will do, the next
  public election and the operator's links, all from data, in Spanish and English, on a desktop and a phone. The API
  serves it at `GET /public/tenants/{slug}/home` (read as `aiontheballot_web`); the web app caches each tenant's copy
  and keeps it when the API fails. The shared preset gains the brand colours as semantic tokens, contrast-tested, and
  the self-hosted fonts. The e2e suite checks the page with axe at both sizes.
- d167b29: The coming-soon page offers the operator's newsletter ("Avísame cuando se publique"), from the new
  `organizations.newsletter_url` (migration `organization_newsletter`); the platform collects no addresses. The ballot is
  now an SVG that scales down to a phone, and the tenant's name is sized by its longest word, which never breaks.

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
