# @aiontheballot/web

## 0.19.17

### Patch Changes

- bb8dab8: The site keeps serving while the API or its database is slow: the health probe no longer waits for the routing
  table, and a table past its age is served at once while a fresh one loads.

## 0.19.16

### Patch Changes

- 5e3e7a7: From the security audit (PLAN R208). The API answers a fault as `unexpected`, never with its message, reports it
  once, by its code, and answers an unknown route under `/api` with its own headers. The error relays refuse what a
  browser marks as sent from any other origin, and the admin's chart can limit its relay per address, as the web chart
  does. The share images take fflate 0.7.5, which fixes an advisory in code they never call. The migrations image is
  unchanged, rebuilt only because the shared lockfile changed.
- Updated dependencies [5e3e7a7]
  - @aiontheballot/observability@0.2.7
  - @aiontheballot/og@0.7.3

## 0.19.15

### Patch Changes

- 6bc197c: Rebuilt only because the shared lockfile changed (the API's image dropped the authentication library's optional
  peers); this image is unchanged.

## 0.19.14

### Patch Changes

- e1010f7: Comments, chart notes and examples describe what the platform needs from its host, never the host itself (PLAN
  R205): the deployment's specifics stay in the operator's private configuration. No behaviour changes.
- Updated dependencies [e1010f7]
  - @aiontheballot/observability@0.2.6

## 0.19.13

### Patch Changes

- Updated dependencies [8bf6d1e]
  - @aiontheballot/i18n@0.28.0

## 0.19.12

### Patch Changes

- 1ffae74: Dependencies bmp
- Updated dependencies [1ffae74]
  - @aiontheballot/domain@0.14.1
  - @aiontheballot/i18n@0.27.4
  - @aiontheballot/observability@0.2.5
  - @aiontheballot/og@0.7.2

## 0.19.11

### Patch Changes

- Updated dependencies [31b4f06]
  - @aiontheballot/i18n@0.27.3

## 0.19.10

### Patch Changes

- Updated dependencies [6164fb1]
  - @aiontheballot/i18n@0.27.2

## 0.19.9

### Patch Changes

- Updated dependencies [a232017]
  - @aiontheballot/i18n@0.27.1

## 0.19.8

### Patch Changes

- 83137c3: Clip times are written as minutes and seconds; a report can be decided at once, its choices explained; a new site's
  country is chosen by name; the methodology and legal texts show a preview rendered as the public site renders them,
  whose renderer now lives in the domain package (PLAN R196, admin forms step 9).
- Updated dependencies [83137c3]
  - @aiontheballot/domain@0.14.0
  - @aiontheballot/i18n@0.27.0
  - @aiontheballot/og@0.7.1

## 0.19.7

### Patch Changes

- Updated dependencies [0038242]
  - @aiontheballot/i18n@0.26.0

## 0.19.6

### Patch Changes

- Updated dependencies [b102dd1]
  - @aiontheballot/i18n@0.25.0

## 0.19.5

### Patch Changes

- Updated dependencies [93687c9]
  - @aiontheballot/i18n@0.24.0

## 0.19.4

### Patch Changes

- Updated dependencies [1821b6f]
  - @aiontheballot/i18n@0.23.0

## 0.19.3

### Patch Changes

- Updated dependencies [0dd4cc8]
  - @aiontheballot/i18n@0.22.0

## 0.19.2

### Patch Changes

- Updated dependencies [0cf0a92]
  - @aiontheballot/i18n@0.21.0

## 0.19.1

### Patch Changes

- 3d744f0: The public site tries a read of the API once more when the connection closed before any answer, as an API pod
  shutting down in a rollout does, so a page no longer answers 500 for it (PLAN R188).
- Updated dependencies [5cbf267]
- Updated dependencies [1f79c8a]
  - @aiontheballot/i18n@0.20.0

## 0.19.0

### Minor Changes

- 77f1e8f: Sharing, data first: one "Compartir" panel under each election page's title, the data image first (square, portrait
  or story; to the phone's apps or downloaded) and the link second. The election page's link preview now shows every
  party's rating on every criterion, and the party, criterion and whole-table cards are redrawn in the same style; every
  data card carries its data's date and the site's address, with no totals and no ranking (PLAN R185).

### Patch Changes

- Updated dependencies [77f1e8f]
  - @aiontheballot/og@0.7.0
  - @aiontheballot/i18n@0.19.0

## 0.18.0

### Minor Changes

- 362ae1e: A party shows as its logo, without a frame, in a box of one size, or else as a rounded square of its colour, with
  its colour as a thin line under its name (under the logo beside a link, so it never reads as a second underline):
  on the site, its share images and the admin's party list, in place of the colour square (PLAN R184).

### Patch Changes

- Updated dependencies [362ae1e]
  - @aiontheballot/og@0.6.0

## 0.17.0

### Minor Changes

- f5ab992: A live election's party, criterion, reviewer, methodology or the election itself changes through one request for
  any of its fields at once, each shown beside what it is now, with one public note: proposed, reviewed and applied as
  one, and listed field by field in the change list and both corrections logs; a party's new logo is uploaded first
  (PLAN R183). The party form takes the logo, previewed before it is uploaded, also when creating a party; a new party
  has no colour until someone picks one; the party page shows its name and logo first and stays put after a save;
  the list shows each party's logo and what it still lacks. Invitations start on the editing role, and the
  organization form says which legal details only a site's operator needs.

### Patch Changes

- Updated dependencies [f5ab992]
  - @aiontheballot/domain@0.13.0
  - @aiontheballot/i18n@0.18.0
  - @aiontheballot/og@0.5.3

## 0.16.0

### Minor Changes

- d7e62ac: An election can go to preview before it goes live: its site's members see it in the admin's preview as the public
  will, and edit it as a draft, while the public sees none of it, read through a database role of its own (PLAN R181).

### Patch Changes

- e091b88: The end-to-end task passes the preview's database URL through, as CI sets it (PLAN R181).
- Updated dependencies [d7e62ac]
- Updated dependencies [1c8713b]
  - @aiontheballot/domain@0.12.0
  - @aiontheballot/i18n@0.17.0
  - @aiontheballot/og@0.5.2

## 0.15.1

### Patch Changes

- 1578588: A party without a colour leaves a blank space beside its name instead of an empty square; a password link written
  just after an authenticator reset is forgotten rather than mailed (PLAN R180).
- Updated dependencies [1578588]
  - @aiontheballot/og@0.5.1

## 0.15.0

### Minor Changes

- 3854bad: Country admins choose their site's colour in Settings, and the public site and its share images take it, with the
  text that reads on it; parties' colours show beside their names on the share images (PLAN R178).

### Patch Changes

- 3d17625: A site's own colour keeps focus rings, borders and the coming-soon page's button visible on it, the public site
  checks a site's colours again as it loads them, and the colour form's reset and contrast ratio read right (PLAN R178).
- Updated dependencies [3d17625]
- Updated dependencies [3854bad]
  - @aiontheballot/domain@0.11.0
  - @aiontheballot/og@0.5.0
  - @aiontheballot/i18n@0.16.13

## 0.14.0

### Minor Changes

- 6efba86: The scorecard's link preview invites to the page, with the parties' logos and no ratings (PLAN R176), and every
  election page offers share links under its title: WhatsApp, Telegram, X, Facebook, Bluesky, LinkedIn, email, the
  device's share sheet and copying the link (R177).

### Patch Changes

- 65392f7: The share-card invariants test allows a slow runner the time the reference test does; nothing drawn changes.
- Updated dependencies [65392f7]
- Updated dependencies [6efba86]
  - @aiontheballot/og@0.4.0
  - @aiontheballot/i18n@0.16.12

## 0.13.1

### Patch Changes

- Updated dependencies [e906c1e]
  - @aiontheballot/i18n@0.16.11

## 0.13.0

### Minor Changes

- 0cc4860: A site's members preview its public pages through the admin, sandboxed and script-free; the web app's preview host
  answers only with the shared token (ADR-0005, PLAN R174).

### Patch Changes

- Updated dependencies [0cc4860]
  - @aiontheballot/i18n@0.16.10
  - @aiontheballot/domain@0.10.4
  - @aiontheballot/og@0.3.14

## 0.12.14

### Patch Changes

- 483ae64: The whole-table image draws each party's logo beside its name, as the other cards do (PLAN R173).
- Updated dependencies [7582557]
- Updated dependencies [483ae64]
  - @aiontheballot/i18n@0.16.9
  - @aiontheballot/og@0.3.13

## 0.12.13

### Patch Changes

- Updated dependencies [143bd63]
- Updated dependencies [ececa5c]
  - @aiontheballot/i18n@0.16.8

## 0.12.12

### Patch Changes

- Updated dependencies [d93398f]
  - @aiontheballot/i18n@0.16.7

## 0.12.11

### Patch Changes

- 02420fb: Turn off Next's image optimizer in both apps (PLAN R163): neither uses it, and `/_next/image` is now the not-found
  page instead of a fetch inside the server for every caller.
- 7c90561: The table image (PLAN R164) shows every column's header, also when it stands on end next to a narrow party column,
  and its rows and icons grow when there are few parties.
- Updated dependencies [7c90561]
  - @aiontheballot/og@0.3.12

## 0.12.10

### Patch Changes

- dd99189: The whole table as one image (PLAN R162): the scorecard's download dialog offers every party's rating on every
  criterion in the square, portrait and story sizes, drawn by a new share-card template.
- 62ddce3: An opt-in ingress NetworkPolicy for the public site's pods (PLAN R161): when the environment's values turn it on, only
  the gateways' Envoy pods they list and the API's pods may connect. Off by default.
- Updated dependencies [dd99189]
  - @aiontheballot/og@0.3.11
  - @aiontheballot/i18n@0.16.6

## 0.12.9

### Patch Changes

- Updated dependencies [5587bfb]
  - @aiontheballot/i18n@0.16.5

## 0.12.8

### Patch Changes

- 0310193: The web route's traffic policy can carry per-client-address rate limits (PLAN R158): forms, the error and analytics
  relays, and images, in requests a minute, off unless the environment's values set them (global limits, which need
  Envoy Gateway's rate-limit service).

## 0.12.7

### Patch Changes

- Updated dependencies [3ac798b]
  - @aiontheballot/i18n@0.16.4

## 0.12.6

### Patch Changes

- 7083260: Instant refresh on publish (PLAN R151): after an admin write to a site, the API tells every web replica (through a
  headless Service) to refetch that site and election, and each pre-renders the link previews that changed; the web's
  data caches are one per process.
- Updated dependencies [7083260]
  - @aiontheballot/domain@0.10.3
  - @aiontheballot/og@0.3.10

## 0.12.5

### Patch Changes

- 9224479: The corrections log and the records (PLAN R150): a public corrections log per election with its share card, the
  public data's approved structural changes, each revision's private record in the admin, the election's log in the
  admin, and the audit view for a site's country admins and for platform admins.
- Updated dependencies [9224479]
  - @aiontheballot/domain@0.10.2
  - @aiontheballot/i18n@0.16.3
  - @aiontheballot/og@0.3.9

## 0.12.4

### Patch Changes

- 3ba6bb4: The right of reply, end to end (PLAN R149): a public form under each election (no cookies, silent spam checks, limits
  per visitor and site), the API's intake as the public role, the admin's triage queue with internal notes and
  anonymizing, change requests that name the report they answer, and a daily CronJob that anonymizes reports past their
  retention.
- Updated dependencies [3ba6bb4]
  - @aiontheballot/domain@0.10.1
  - @aiontheballot/i18n@0.16.2
  - @aiontheballot/og@0.3.8

## 0.12.3

### Patch Changes

- 3590ae1: Share images for every election page (PLAN R148): the scorecard, parties, criteria, cells and the methodology each
  have their own card, link preview and four-size download, drawn from a theme passed in; changed views' previews are
  pre-rendered when the web app's copy of an election changes.
- Updated dependencies [3590ae1]
  - @aiontheballot/og@0.3.7
  - @aiontheballot/i18n@0.16.1

## 0.12.2

### Patch Changes

- b83859e: Share images follow their pictures by themselves (PLAN R147): each template's build-time fingerprint, from probe
  renders, is folded into its images' hashes, replacing TEMPLATE_VERSION and the pinned SVG; a reference test compares
  the probes with committed pictures, with old, new and diff kept by CI, and `pnpm cards:accept` takes a change.
- Updated dependencies [b83859e]
  - @aiontheballot/og@0.3.6

## 0.12.1

### Patch Changes

- a8ed7d2: Dependencies bump
- Updated dependencies [a8ed7d2]
  - @aiontheballot/observability@0.2.4
  - @aiontheballot/og@0.3.5

## 0.12.0

### Minor Changes

- 4516915: Party logos (PLAN R142): uploaded on a party's admin page while its election is a draft (PNG, JPEG or WebP, up to 2 MB
  and 4,096 pixels a side, checked by its own header), and shown beside the party's name on the public pages.

### Patch Changes

- Updated dependencies [1046110]
- Updated dependencies [c21932d]
- Updated dependencies [bf4876f]
- Updated dependencies [4516915]
  - @aiontheballot/i18n@0.16.0
  - @aiontheballot/domain@0.10.0
  - @aiontheballot/og@0.3.4

## 0.11.1

### Patch Changes

- Updated dependencies [c99354a]
  - @aiontheballot/i18n@0.15.0

## 0.11.0

### Minor Changes

- 658a870: A site's public settings are data (PLAN R135): whether it is open, whether search engines may index it, and its
  Plausible script are switches on the site's admin page, for platform admins, instead of `OPEN_SITES` and
  `PLAUSIBLE_SITES` in the web app's environment. A site kept out of search engines answers `noindex, nofollow`
  everywhere, disallows everything in its robots.txt and has no sitemap, for a demo's fictional content.

### Patch Changes

- Updated dependencies [658a870]
  - @aiontheballot/domain@0.9.0
  - @aiontheballot/i18n@0.14.0

## 0.10.0

### Minor Changes

- b869a83: The public site's election pages (PLAN R125): the scorecard, with a table on desktops and cards per party or per
  criterion on phones, and the party, criterion, cell and methodology pages, every cell able to show "pending", from a
  new public election route in the API. The fixed rating visuals. Security headers on every response (R126); per-site
  sitemaps and robots, and the page's language in `<html lang>` (R127).
- 7bd93a4: The site's own signup list (PLAN R119, R122): double opt-in through three narrow database functions, a confirmation
  email through the platform's one sender (R115, R123), one-click unsubscribe, unconfirmed addresses deleted after 7
  days, and counts for country admins. The legal notice, privacy policy and page about the operator, served before the
  site opens (R124). Site modes (coming soon, open, preview) and a site's own words in its paths (R121).

### Patch Changes

- Updated dependencies [59950f5]
- Updated dependencies [5c4e6b8]
- Updated dependencies [91cfb5a]
- Updated dependencies [b869a83]
- Updated dependencies [4fc2f00]
- Updated dependencies [7bd93a4]
- Updated dependencies [5896c16]
  - @aiontheballot/i18n@0.13.0
  - @aiontheballot/domain@0.8.0
  - @aiontheballot/og@0.3.3

## 0.9.8

### Patch Changes

- 464c259: satori 0.41.0, which draws the share images exactly as 0.38.2 did (their pinned SVG is unchanged).
- Updated dependencies [464c259]
  - @aiontheballot/og@0.3.2

## 0.9.7

### Patch Changes

- 7ba5873: Dependencies bump
- 285b124: Dependencies bump
- Updated dependencies [7ba5873]
- Updated dependencies [4572be4]
  - @aiontheballot/domain@0.7.1
  - @aiontheballot/i18n@0.12.0
  - @aiontheballot/observability@0.2.3
  - @aiontheballot/og@0.3.1

## 0.9.6

### Patch Changes

- Updated dependencies [88fbcfc]
  - @aiontheballot/i18n@0.11.0

## 0.9.5

### Patch Changes

- Updated dependencies [0ebe03a]
  - @aiontheballot/i18n@0.10.0

## 0.9.4

### Patch Changes

- Updated dependencies [ed8f815]
  - @aiontheballot/i18n@0.9.0

## 0.9.3

### Patch Changes

- Updated dependencies [b0342af]
  - @aiontheballot/i18n@0.8.0

## 0.9.2

### Patch Changes

- 47da044: The first account (PLAN R93): `node dist/create-account.js`, run in an API pod, asks for an email and a name, creates
  a verified account and prints a single-use, one-hour link to the admin's new set-password page (its token in the
  fragment, kept hashed), plus the SQL that makes it a platform admin once its person has enrolled TOTP. The API accepts
  that token at /api/auth/reset-password, and setting a password ends the account's sessions. Error reports also drop
  the query and fragment of URL-like context fields and tags.
- Updated dependencies [47da044]
  - @aiontheballot/i18n@0.7.0
  - @aiontheballot/observability@0.2.2

## 0.9.1

### Patch Changes

- 83e9248: Sign in to the admin with a password and a TOTP code (PLAN R84–R92). The API mounts Better Auth's sign-in,
  enrolment and challenge endpoints under /api/auth on the admin host only, records per session whether a second factor
  opened it (migration auth_session_aal), acts at aal2 only for those sessions, and lists a signed-in user's tenants. A
  daily CronJob deletes expired sessions. The admin gets its sign-in, TOTP enrolment and challenge screens in English and
  Spanish.
- 1756b0e: CI passes the sign-in tests' database URLs through Turbo (TEST_ADMIN_DATABASE_URL for the API's database tests; the
  auth, admin and owner URLs for the end-to-end tests), which locally came from .env.
- Updated dependencies [83e9248]
  - @aiontheballot/i18n@0.6.0

## 0.9.0

### Minor Changes

- 94c11b3: The public site loads each tenant's Plausible script from its own host and relays the script's events
  (`/_relay/views.js`, `/_relay/views`; PLAN R83): every Plausible feature, no request to another host, no cookie. It
  counts nothing until the deployment sets `PLAUSIBLE_URL` and `PLAUSIBLE_SITES`.

### Patch Changes

- 874daf8: The coming-soon page gives the next election's date in full on a line of its own ("Domingo, 29 de noviembre de 2026"),
  says "Una iniciativa de" once, in the footer, and no longer offers the operator's newsletter as "Avísame cuando se
  publique" (PLAN R82). The translator formats dates in UTC, so an election's date never moves a day with the server's
  time zone.
- Updated dependencies [94c11b3]
- Updated dependencies [874daf8]
  - @aiontheballot/observability@0.2.1
  - @aiontheballot/i18n@0.5.1

## 0.8.2

### Patch Changes

- 4f5e76a: Better Auth's tables, in the `auth` schema that only `aiontheballot_auth` reaches (migration `auth_schema`,
  ADR-0002 §2), and `createAuthPool` for its connections. Nothing signs in yet.

## 0.8.1

### Patch Changes

- 01a9f7f: The admin API's answer to a database refusal (editorial workflow §2.3): its SQLSTATE becomes the HTTP status and a
  message key, in English and Spanish, never the database's own message. A missing grant is reported as the fault it
  is.
- 944fcc8: The cell editor's live quote match (editorial workflow C2.6, W13): `matchQuote` in `packages/domain` says whether a
  quote matches its source verbatim and on which pages, exactly as the database will, how much of it does if not, or
  that it is too short or too long to save.
- f10bcac: An election's slug can never be `brand`, `og` or `healthz`, paths the public site serves itself (migration
  `reserved_election_slugs`; `RESERVED_ELECTION_SLUGS` in `packages/domain`).
- 07fb157: The pods mark their scratch volumes for file-system backups to skip: of the API's, only the file volume is
  copied.
- Updated dependencies [01a9f7f]
- Updated dependencies [944fcc8]
- Updated dependencies [f10bcac]
  - @aiontheballot/i18n@0.5.0
  - @aiontheballot/domain@0.7.0

## 0.8.0

### Minor Changes

- 7f83fd8: Site icons: the platform's default (the coming-soon ballot, marked with the AI sparkle, on an orange tile), or a
  tenant's own square PNG from its new `site_icon` logo slot (a whole PNG, 512 to 1,024 px). Pages name the icons by
  content hash at `/brand/icon/{size}.{hash}.png`, cached as immutable, with `/favicon.ico` and a web manifest. The
  seeds give `ejemplo-a` a fictional icon.

### Patch Changes

- Updated dependencies [7f83fd8]
  - @aiontheballot/og@0.3.0
  - @aiontheballot/domain@0.6.0

## 0.7.1

### Patch Changes

- a2cea6d: File bytes move from Postgres to a persistent volume (migration `files_on_volume`, ADR-0004): the API mounts a
  node-local volume at `/data` and reads each file's bytes from its row's own tenant and bucket, only
  for a row RLS shows, checking the hash on every read. `file_blobs` and the brand assets' inline bytes are gone; the
  migration refuses to run while any bytes are stored in the database. `node dist/put-file.js <tenant-id> <bucket>`
  puts bytes on the volume from stdin until the admin can upload them, and `node dist/purge-tenant-files.js` deletes a
  purged tenant's folder, given proof of the purge. Web and admin are rebuilt only because turbo.json changed.

## 0.7.0

### Minor Changes

- 2a30cfe: Link previews get their own shorter description (under 125 characters, which phones show), and search keeps the full
  sentence.

### Patch Changes

- Updated dependencies [2a30cfe]
  - @aiontheballot/i18n@0.4.0

## 0.6.0

### Minor Changes

- 1f4eabe: Tenants' own logos (migration `tenant_brand_uploads`): a brand selection can name one of the tenant's uploaded
  images, public while an active tenant selects it. The API serves the home data's brand images by hash; the web app
  shows the operator's logo in the coming-soon page's header and footer, at `/brand/{sha256}.{ext}` cached as immutable,
  and draws it on the share cards.

### Patch Changes

- Updated dependencies [1f4eabe]
  - @aiontheballot/domain@0.5.0
  - @aiontheballot/i18n@0.3.0
  - @aiontheballot/og@0.2.0

## 0.5.0

### Minor Changes

- 0bcb112: Link previews for the coming-soon page: Open Graph and Twitter tags, the canonical address and `hreflang` from the
  routing table, and share images in the four sizes from the new `packages/og` (satori, then resvg, fonts embedded),
  served from content-hash URLs cached as immutable, with 304s. Images are pre-rendered while their page renders and
  when a server starts. The hero's name is sized by the viewport's height too.

### Patch Changes

- Updated dependencies [0bcb112]
  - @aiontheballot/og@0.1.0
  - @aiontheballot/domain@0.4.0

## 0.4.0

### Minor Changes

- 2f43760: A tenant's home is now its coming-soon page, in PauseAI's brand: the tenant's name, what the site will do, the next
  public election and the operator's links, all from data, in Spanish and English, on a desktop and a phone. The API
  serves it at `GET /public/tenants/{slug}/home` (read as `aiontheballot_web`); the web app caches each tenant's copy
  and keeps it when the API fails. The shared preset gains the brand colours as semantic tokens, contrast-tested, and
  the self-hosted fonts. The e2e suite checks the page with axe at both sizes.
- d167b29: The coming-soon page offers the operator's newsletter ("Avísame cuando se publique"), from the new
  `organizations.newsletter_url` (migration `organization_newsletter`); the platform collects no addresses. The ballot is
  now an SVG that scales down to a phone, and the tenant's name is sized by its longest word, which never breaks.

### Patch Changes

- Updated dependencies [2f43760]
- Updated dependencies [d167b29]
  - @aiontheballot/domain@0.3.0
  - @aiontheballot/i18n@0.2.0

## 0.3.0

### Minor Changes

- 685914f: Route the public site by host: the web app's `proxy.ts` runs `resolve()` with routing data from the API's new
  `GET /public/routing` (read as `aiontheballot_web`), rewriting tenant pages to their internal path, redirecting aliases
  and platform paths, and answering 404 to everything else. The e2e stack runs on a migrated, seeded database and tests
  status codes, `Location`, a spoofed `X-Forwarded-Host`, the internal prefix and the absence of cookies.

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
