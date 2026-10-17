# @aiontheballot/migrations

## 0.27.0

### Minor Changes

- 6df3e0a: A member's token may add, edit and order an election's criteria while it is edited directly, never delete one nor
  link one to a core criterion; the MCP server has tools for them, carrying only wording a person approved.

## 0.26.0

### Minor Changes

- cc0b07b: Platform admins can delete an election permanently, whatever its status, with everything in it and its audit trail,
  after typing its address name; a record of the purge stays. The web app only picks up the admin's new texts.

## 0.25.3

### Patch Changes

- 5e3e7a7: From the security audit (PLAN R208). The API answers a fault as `unexpected`, never with its message, reports it
  once, by its code, and answers an unknown route under `/api` with its own headers. The error relays refuse what a
  browser marks as sent from any other origin, and the admin's chart can limit its relay per address, as the web chart
  does. The share images take fflate 0.7.5, which fixes an advisory in code they never call. The migrations image is
  unchanged, rebuilt only because the shared lockfile changed.

## 0.25.2

### Patch Changes

- 6bc197c: Rebuilt only because the shared lockfile changed (the API's image dropped the authentication library's optional
  peers); this image is unchanged.

## 0.25.1

### Patch Changes

- e1010f7: Comments, chart notes and examples describe what the platform needs from its host, never the host itself (PLAN
  R205): the deployment's specifics stay in the operator's private configuration. No behaviour changes.

## 0.25.0

### Minor Changes

- 78de939: A member's tokens for tools, in the database (PLAN R202, ADR-0008): minted only from the member's live session
  opened with their verified second factor, 30 days at most, revoked with any change of their password or second
  factor; through one, every table refuses writes but those drafting an election's parties needs, and the audit log
  names the token beside its member. The owner's reset of an authenticator counts the sessions it ends before removing
  the factor.

## 0.24.1

### Patch Changes

- 1ffae74: Dependencies bmp

## 0.24.0

### Minor Changes

- 7be0c98: The same image is never both a restricted brand asset and an unrestricted one: the database refuses, at commit, a
  transaction that leaves one so, whoever writes it, and the migration refuses to run while one is stored so. An
  organization's logo reuses a restricted image of the same bytes, and is refused when that image's row gives the bytes
  another type (PLAN R200).

## 0.23.0

### Minor Changes

- 6164fb1: The invitation page names the site it invites to: the database's lookup of a pending invitation also returns its
  site's display name and main language (PLAN R199, ADR-0002 §10 amended).

## 0.22.0

### Minor Changes

- f5ab992: A live election's party, criterion, reviewer, methodology or the election itself changes through one request for
  any of its fields at once, each shown beside what it is now, with one public note: proposed, reviewed and applied as
  one, and listed field by field in the change list and both corrections logs; a party's new logo is uploaded first
  (PLAN R183). The party form takes the logo, previewed before it is uploaded, also when creating a party; a new party
  has no colour until someone picks one; the party page shows its name and logo first and stays put after a save;
  the list shows each party's logo and what it still lacks. Invitations start on the editing role, and the
  organization form says which legal details only a site's operator needs.

## 0.21.0

### Minor Changes

- d7e62ac: An election can go to preview before it goes live: its site's members see it in the admin's preview as the public
  will, and edit it as a draft, while the public sees none of it, read through a database role of its own (PLAN R181).

### Patch Changes

- e091b88: The end-to-end task passes the preview's database URL through, as CI sets it (PLAN R181).

## 0.20.6

### Patch Changes

- e906c1e: Copies by URL and archive snapshots through a fetcher with no database login and no volume (ADR-0007, PLAN R175): a
  fetched copy is stored as the requester's upload, and the worker records each snapshot; off until gitops turns it on.

## 0.20.5

### Patch Changes

- 7582557: A "replaced" mark on a source (PLAN R172, D14): set once by those who write sources, it keeps the source out of
  new quotes and checks and lists it last; what cites it stays.

## 0.20.4

### Patch Changes

- 7d4f2ac: An attester who wrote or uploaded any of a cell's draft is refused (PLAN R167, D17a): while the election requires a
  second reviewer, no contributor of the cell as four-eyes counts them attests its quotes, nor does an editor who
  rewrites a quote as they attest it, and an attestation that stops meeting the rule lapses.
- 411182d: The public role keeps only what the public API reads (PLAN R169, D17c): a column grant on tenant_documents without
  its author, no SELECT on hostname_tombstones and no USAGE on the private schema.

## 0.20.3

### Patch Changes

- d93398f: A correction names the report it answers (PLAN D16): migration `draft_report_link` adds `assessments.draft_report_id`,
  which publishing copies into the revision's private record; the cell editor offers it after the first publish.

## 0.20.2

### Patch Changes

- 91404d2: Three gaps from a review of the database's row security, closed (PLAN R165): only a fetch job stores a source's copy
  as fetched, only a cell's trail records its contributors, and the immutable tables' purge exemption asks who logged
  in.

## 0.20.1

### Patch Changes

- 33b7ee1: The owner's reset of a lost authenticator (PLAN R156): `reset-authenticator.js` removes an account's TOTP and backup
  codes and ends its sessions, so its next sign-in enrols again; it prints no personal data. Migration
  `aal2_needs_second_factor`: an aal2 session is written only while its account's second factor exists.

## 0.20.0

### Minor Changes

- 09dbde9: The sweep of orphaned bytes can run on a schedule (PLAN R117, R141): migration `file_sweep_list` adds
  `private.file_sweep_list()`, the list of named files, executable by a new login, `aiontheballot_sweeper`, only;
  `sweep-files --from-database` reads it with that login; and the API's chart renders a weekly CronJob once gitops names
  the login's secret. The owner's manual sweep reads the same list.

### Patch Changes

- 1046110: Change requests after an adversarial review (PLAN R144): only country admins and platform admins approve, in the
  database too; two approvals of one target run one after the other; proposals are checked as a draft's forms check
  them, with the site's main language required at once; additions waiting for a decision keep their order; clearer
  buttons and wording in the admin.

## 0.19.0

### Minor Changes

- c99354a: Sources (editorial workflow §7): editors add an election's sources, store a copy of each (uploaded, up to 50 MB, the
  same bytes kept once per site, checked before a byte is read and streamed to the store), and members read the text
  extracted from it and download the copy. A new worker (`node dist/worker.js`, PLAN R116, R133 and R139) extracts the
  text one copy at a time, each in a child process with a memory limit, a deadline and no access to the disk, the
  network or its environment; the chart renders it only once gitops names its database login, and the API hands it
  each job (PLAN D12). Migration `open_extraction_once`: one open extraction job per source.

## 0.18.0

### Minor Changes

- 658a870: A site's public settings are data (PLAN R135): whether it is open, whether search engines may index it, and its
  Plausible script are switches on the site's admin page, for platform admins, instead of `OPEN_SITES` and
  `PLAUSIBLE_SITES` in the web app's environment. A site kept out of search engines answers `noindex, nofollow`
  everywhere, disallows everything in its robots.txt and has no sitemap, for a demo's fictional content.

## 0.17.0

### Minor Changes

- 7bd93a4: The site's own signup list (PLAN R119, R122): double opt-in through three narrow database functions, a confirmation
  email through the platform's one sender (R115, R123), one-click unsubscribe, unconfirmed addresses deleted after 7
  days, and counts for country admins. The legal notice, privacy policy and page about the operator, served before the
  site opens (R124). Site modes (coming soon, open, preview) and a site's own words in its paths (R121).

### Patch Changes

- 5c4e6b8: Invitations (PLAN R114): country admins invite someone by email with a role from the members page, revoke and delete
  invitations; the invited person follows the link, chooses a name and a password if they have no account, and the
  membership is theirs once they have set up their second factor.
- b869a83: The public site's election pages (PLAN R125): the scorecard, with a table on desktops and cards per party or per
  criterion on phones, and the party, criterion, cell and methodology pages, every cell able to show "pending", from a
  new public election route in the API. The fixed rating visuals. Security headers on every response (R126); per-site
  sitemaps and robots, and the page's language in `<html lang>` (R127).
- 4fc2f00: The quote normalisers follow Unicode's rules on both sides (PLAN R113): letters and spaces are Unicode's Alphabetic
  and White_Space, the database's under `pg_c_utf8`, and a byte-order mark is dropped. The migration stops if any stored
  text would normalise differently.

## 0.16.0

### Minor Changes

- 74222eb: No archiving inside a freeze window (PLAN R109, D11): an election goes from live to archived only once its freeze
  window is over or cleared, so an archived election's corrections can't stay frozen for good.

## 0.15.0

### Minor Changes

- 0ebe03a: Elections and their structure (editorial workflow §6, P1; PLAN R101–R106). Editors create elections as drafts and
  change them while they are; country admins announce and delete them, and write the methodology and its named external
  reviewers, take them live after a checklist and a typed confirmation, set their freeze window and archive them;
  platform admins turn four-eyes off after a confirmation. Editors add, order by keyboard, change and delete parties and
  criteria. Live and archived elections are shown read-only. Two migrations: `slug_length` (slugs stop at 63
  characters) and `report_retention_cap` (reports are kept a century at most). New API routes under
  `/api/t/:tenant/elections` and `/api/t/:tenant/e/:election`, with its `checklist`, `methodology`,
  `methodology/reviewers`, `parties` and `criteria`.

## 0.14.0

### Minor Changes

- 83e9248: Sign in to the admin with a password and a TOTP code (PLAN R84–R92). The API mounts Better Auth's sign-in,
  enrolment and challenge endpoints under /api/auth on the admin host only, records per session whether a second factor
  opened it (migration auth_session_aal), acts at aal2 only for those sessions, and lists a signed-in user's tenants. A
  daily CronJob deletes expired sessions. The admin gets its sign-in, TOTP enrolment and challenge screens in English and
  Spanish.

### Patch Changes

- 1756b0e: CI passes the sign-in tests' database URLs through Turbo (TEST_ADMIN_DATABASE_URL for the API's database tests; the
  auth, admin and owner URLs for the end-to-end tests), which locally came from .env.

## 0.13.0

### Minor Changes

- 4f5e76a: Better Auth's tables, in the `auth` schema that only `aiontheballot_auth` reaches (migration `auth_schema`,
  ADR-0002 §2), and `createAuthPool` for its connections. Nothing signs in yet.

## 0.12.1

### Patch Changes

- 9d44cb0: Better Auth gets its own database role, `aiontheballot_auth` (ADR-0002 §2), created locally and in CI and kept
  out of `app` and `private` by the catalog tests. Nothing uses it yet.

## 0.12.0

### Minor Changes

- f10bcac: An election's slug can never be `brand`, `og` or `healthz`, paths the public site serves itself (migration
  `reserved_election_slugs`; `RESERVED_ELECTION_SLUGS` in `packages/domain`).

## 0.11.0

### Minor Changes

- bc2fe41: A country admin may announce a draft election (migration `announced_elections`), so a tenant's coming-soon page names
  it and gives its date before it goes live. The public sees the announced election's own row and nothing under it.
  ADR-0002's public-visibility rule is amended accordingly (PLAN R51).

## 0.10.0

### Minor Changes

- a2cea6d: File bytes move from Postgres to a persistent volume (migration `files_on_volume`, ADR-0004): the API mounts a
  node-local volume at `/data` and reads each file's bytes from its row's own tenant and bucket, only
  for a row RLS shows, checking the hash on every read. `file_blobs` and the brand assets' inline bytes are gone; the
  migration refuses to run while any bytes are stored in the database. `node dist/put-file.js <tenant-id> <bucket>`
  puts bytes on the volume from stdin until the admin can upload them, and `node dist/purge-tenant-files.js` deletes a
  purged tenant's folder, given proof of the purge. Web and admin are rebuilt only because turbo.json changed.

## 0.9.0

### Minor Changes

- 1f4eabe: Tenants' own logos (migration `tenant_brand_uploads`): a brand selection can name one of the tenant's uploaded
  images, public while an active tenant selects it. The API serves the home data's brand images by hash; the web app
  shows the operator's logo in the coming-soon page's header and footer, at `/brand/{sha256}.{ext}` cached as immutable,
  and draws it on the share cards.

## 0.8.0

### Minor Changes

- d530322: Criteria get a short title (migration `criteria_short_title`), the public table's column header now that parties
  always run down the side. Going live needs one in the default locale for every criterion, a public election's criteria
  keep it, and once live it is change-controlled like the title.

## 0.7.0

### Minor Changes

- 5d9b0e2: Ship migration `organization_newsletter` (`organizations.newsletter_url`), which the coming-soon release needs: its
  changeset bumped the API and web but not this package, so the migration image wasn't rebuilt and production's API
  asked for a column that didn't exist yet.

## 0.6.0

### Minor Changes

- 3650ed0: Add the cell workflow: submit, recall, reject with a note and publish transitions; the content lock while in review;
  content versions; contributors and review events written by triggers; and archived elections taking only corrections
  and withdrawals.
- 30cd780: Add change control for live elections: `change_requests`, the public `structural_changes` and the `corrections_log`
  view. A live election's structure changes only through a request approved in the same transaction, applied by the
  approver, with a second approver when the tenant requires one and no approvals in the freeze window.
- d02ea23: Add the evidence rules: quotes and checked documents cite only stored, extracted sources of no party or the cell's
  party, of kinds the methodology admits; quotes are matched verbatim across pages (or attested by a second person for
  sources without text); submitting needs every quote matched or attested.
- 60e7e1d: Add the programme-status rules: "published" needs the party's programme among its sources; every update stamps the
  check date and is refused inside the freeze window; publishing a programme flags the party's "not mentioned" ratings
  for a recheck.
- ad628fb: Add publishing: `private.publish_revision()`, the trigger behind `INSERT INTO app.assessment_revisions
(assessment_id, reviewed_version)`. It checks the publisher, four-eyes, the election and freeze window, the change kind
  and note, re-runs the verbatim match and the evidence requirement, copies the reviewed draft and starts the next
  generation.
- f89b648: Add `private.purge_tenant()`, executable only by the owner: it deletes every row of a tenant (published history and
  audit rows included), keeps its hostnames as tombstones and records the purge in `purge_log`.
- bdde473: Add right-of-reply reports: `app.submit_report()` (the public's only write, with a per-tenant daily cap), triage by
  members (never platform admins), anonymization on request or by the worker's daily
  `private.anonymize_expired_reports()`, and personal-data columns kept out of the audit log.
- 5153712: Add published revisions: `assessment_revisions`, `revision_evidence`, `revision_checked_documents`, the private
  `revision_internal` and the `current_revisions` view. All immutable; publishers insert only the cell and the version
  reviewed; the public reads revisions of live and archived elections of active tenants and the sources they cite.

## 0.5.0

### Minor Changes

- 7c39e38: Add cells: `assessments`, `assessment_contributors`, `draft_evidence`, `draft_checked_documents` and `review_events`.
  Editors and country admins write draft content; reviewers change only the state and attest quotes; every member
  reads. Also fix `app.localized`, whose check refused SQL NULL, so nullable localized columns can use it.
- 6d88a26: Add the election lifecycle: draft → live → archived, never back. Going live needs an active tenant with its operator,
  a methodology and default-locale texts, and stamps `went_live_at`; slugs, type and territory are fixed once live;
  archived elections and their structure are read-only. Territories stay inside the tenant's country, methodologies use
  the tenant's kind and a demands owner it links to, and a tenant's kind and country are fixed by the data that uses them.
- ef654e8: Add an election's structure: `core_criteria`, `elections`, `methodologies`, `methodology_reviewers`, `parties` and
  `criteria`. Editors and country admins write elections, parties and criteria; country admins set status and the freeze
  window and write the methodology and its external reviewers; only platform admins change four-eyes review. New
  elections start as drafts; structure is deleted only in drafts. The public reads live and archived elections of active
  tenants, and the images their parties show as logos.
- 72e2756: Add job requests and the worker's access. The worker sets `app.job_request_id` and acts as the request's requester;
  its RLS shows only that open request and what it names (its tenant, source, the source's copy and pages, its LLM run
  and the run's election), a trigger limits what each job kind may change, and finishing the request ends what it
  authorizes. Requests are made only when their job has something to do, and change only by finishing, once.
- 5136158: Add the LLM assistance schema (the feature is M4): `llm_runs`, refused once the tenant's monthly cap is reached (a cap
  of 0 turns it off) and moving queued → running → done or failed; and `llm_suggestions`, with a rating of the tenant's
  scale, accepted or rejected once by an editor.
- 6d4ada4: Add source documents and their extracted text. A source's stored copy (a sources-bucket file) is set once, with its
  hash and time from the file and the session; after that only its extraction status (one way) and archive URL (once)
  change. Extracted text is private, added only while the source is pending, and never changed. Editors and country
  admins add and edit sources until their copy is stored; members read them.

## 0.4.0

### Minor Changes

- 312495f: Add stored files: `app.files` (metadata) and `app.file_blobs` (bytes) under the same RLS. Bytes must match the
  file's SHA-256 and size; nothing is ever updated; a file is deleted only while unreferenced, with its bytes. Editors
  and country admins upload and delete; members read. The original filename is personal data.
- 9557541: Add the operator's policy texts, `app.tenant_documents`: versioned per tenant and kind by trigger, drafts editable and
  deletable by country admins, published versions frozen (even for the owner) and requiring text in the tenant's default
  locale. The public reads published versions of active tenants.

## 0.3.0

### Minor Changes

- af3eb82: Add the audit log: `app.audit_log`, immutable, and the `private.audit()` trigger on every table, which records each
  write with its tenant, actor, key and diff and never copies columns commented `personal data`. Country admins read
  their tenant's entries; platform admins read all of them.
- eb77f18: Add hostnames: `platform_hostnames`, `tenant_hostnames`, `hostname_tombstones` and `hostname_verifications`, with the
  `app.hostname` domain (the form `resolve()` normalizes to). Only platform admins write them; hostnames are never
  deleted, renamed or moved; reserved and tombstoned names can't be claimed; at most one canonical hostname per tenant,
  verified and not retired. The public reads verified hostnames of active tenants and all tombstones.
- 87a226b: Add invitations: `app.invitations`, visible only to country admins and platform admins, storing only the token's
  SHA-256, expiring within 30 days, and changing once (revoked, or accepted before expiry, with time and acceptor from
  the session). Non-pending invitations can be deleted, so emails aren't kept longer than needed. The matrix supports
  per-row rules for row states.
- 0a492d7: Require exactly one operator for every active tenant: a deferred check when a tenant is created or made active, and
  whenever an operator link is removed or demoted, so a tenant and its operator (or a new operator) can be set in one
  transaction.
- eaddfe3: Add organizations and brand assets: `organizations`, `tenant_organizations` (one operator per tenant), `brand_assets`
  (PNG, JPEG or WebP up to 2 MB, hash checked), `brand_asset_grants` and `tenant_brand_selections`. Platform admins write
  organizations, links, assets and grants; country admins choose their tenant's selections. Writes to a shared
  organization or asset bump every tenant that shows it, and the audit log no longer copies binary columns.
- 2cd4215: Add the public cache key: `app.public_versions`, one counter per tenant that the public reads (active tenants only)
  and that only the `SECURITY DEFINER` trigger `private.bump_public_version()` moves, on every write to a table the
  public can read. No runtime role can set or rewind it.
- 60af0d5: Restrict restricted brand assets to eligible tenants: a tenant may select one only if its operator is a PauseAI
  chapter and the asset was granted to it, and an organization may use one as its logo only if it is a chapter. A
  deferred check re-runs whenever any of those inputs changes.
- 9208dc8: Add tenancy: `tenants`, `platform_admins` and `memberships` with RLS, and the policy helpers `private.my_tenants()`
  and `private.is_platform_admin()` (aal2 only). The admin shows each user only what is theirs; public-visibility
  policies are for `aiontheballot_web` only. Country admins change only their tenant's theme, report retention and LLM
  cap. The isolation matrix now generates its cases from per-table rules and runs them against shared fixtures.

## 0.2.0

### Minor Changes

- f9761d6: Add the column conventions of the data model (spec §1): the domains `app.localized`, `app.slug` and `app.locale`,
  checked with built-in functions only, and `private.stamp()`, which sets actor columns and event timestamps from the
  session. A catalog test fails if any table leaves one of those columns unstamped.
- e6553a1: Add the data model's enumerations (spec §2) in schema `app`, closed to `PUBLIC` like every other object. A test keeps
  them identical to the spec and to the rating constants in `@aiontheballot/domain`.

## 0.1.0

### Minor Changes

- 6ed9131: Ship Docker images: web, admin and api built with turbo prune (manifest-only install layer), running as non-root, and
  a migrations image (dbmate plus the migrations) for the chart's PreSync Job. The Next apps run panda codegen as part of
  their build, so builds no longer depend on install-time hooks.

### Patch Changes

- 8a9f648: Add the Helm charts: a subchart per deployable and the `aiontheballot` umbrella chart (migrations as an Argo CD PreSync Job,
  routes for the public and admin hosts, restrictive security contexts and resource limits).
- 6c95c16: Run the migration Job as an Argo CD Sync hook in wave -1 instead of PreSync, so on a first sync it runs after the gitops
  Secrets and the registry's pull secret exist, and still before the new pods roll out.
