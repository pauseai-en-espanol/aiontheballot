# @aiontheballot/db

## 0.10.1

### Patch Changes

- 9d44cb0: Better Auth gets its own database role, `aiontheballot_auth` (ADR-0002 §2), created locally and in CI and kept
  out of `app` and `private` by the catalog tests. Nothing uses it yet.

## 0.10.0

### Minor Changes

- 70a6a4e: The orphan-bytes sweep (ADR-0004 §5): `node dist/sweep-files.js` reads the owner's list of every file row, brand asset
  and file a row stopped naming (`--print-query` prints the query) and, with `--delete`, deletes bytes no row has named
  for longer than the grace period (120 days, never less than 111), never ones stored or reused within a day of the list,
  and nothing in a run after a database restore.

### Patch Changes

- f10bcac: An election's slug can never be `brand`, `og` or `healthz`, paths the public site serves itself (migration
  `reserved_election_slugs`; `RESERVED_ELECTION_SLUGS` in `packages/domain`).

## 0.9.0

### Minor Changes

- bc2fe41: A country admin may announce a draft election (migration `announced_elections`), so a tenant's coming-soon page names
  it and gives its date before it goes live. The public sees the announced election's own row and nothing under it.
  ADR-0002's public-visibility rule is amended accordingly (PLAN R51).

## 0.8.1

### Patch Changes

- 7f83fd8: Site icons: the platform's default (the coming-soon ballot, marked with the AI sparkle, on an orange tile), or a
  tenant's own square PNG from its new `site_icon` logo slot (a whole PNG, 512 to 1,024 px). Pages name the icons by
  content hash at `/brand/icon/{size}.{hash}.png`, cached as immutable, with `/favicon.ico` and a web manifest. The
  seeds give `ejemplo-a` a fictional icon.

## 0.8.0

### Minor Changes

- a2cea6d: File bytes move from Postgres to a persistent volume (migration `files_on_volume`, ADR-0004): the API mounts a
  `local-path` volume of type `local` at `/data` and reads each file's bytes from its row's own tenant and bucket, only
  for a row RLS shows, checking the hash on every read. `file_blobs` and the brand assets' inline bytes are gone; the
  migration refuses to run while any bytes are stored in the database. `node dist/put-file.js <tenant-id> <bucket>`
  puts bytes on the volume from stdin until the admin can upload them, and `node dist/purge-tenant-files.js` deletes a
  purged tenant's folder, given proof of the purge. Web and admin are rebuilt only because turbo.json changed.

## 0.7.0

### Minor Changes

- 1f4eabe: Tenants' own logos (migration `tenant_brand_uploads`): a brand selection can name one of the tenant's uploaded
  images, public while an active tenant selects it. The API serves the home data's brand images by hash; the web app
  shows the operator's logo in the coming-soon page's header and footer, at `/brand/{sha256}.{ext}` cached as immutable,
  and draws it on the share cards.

## 0.6.0

### Minor Changes

- d530322: Criteria get a short title (migration `criteria_short_title`), the public table's column header now that parties
  always run down the side. Going live needs one in the default locale for every criterion, a public election's criteria
  keep it, and once live it is change-controlled like the title.

## 0.5.0

### Minor Changes

- d167b29: The coming-soon page offers the operator's newsletter ("Avísame cuando se publique"), from the new
  `organizations.newsletter_url` (migration `organization_newsletter`); the platform collects no addresses. The ballot is
  now an SVG that scales down to a phone, and the tenant's name is sized by its longest word, which never breaks.

### Patch Changes

- 2f43760: A tenant's home is now its coming-soon page, in PauseAI's brand: the tenant's name, what the site will do, the next
  public election and the operator's links, all from data, in Spanish and English, on a desktop and a phone. The API
  serves it at `GET /public/tenants/{slug}/home` (read as `aiontheballot_web`); the web app caches each tenant's copy
  and keeps it when the API fails. The shared preset gains the brand colours as semantic tokens, contrast-tested, and
  the self-hosted fonts. The e2e suite checks the page with axe at both sizes.

## 0.4.0

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
- 9118d0d: Add fictional seeds (`pnpm db:seed`): three tenants with hostnames, a live election and a published cell, loaded through
  the real triggers. The seed refuses any database that is not on this machine, and any that holds other tenants.

## 0.3.0

### Minor Changes

- 7c39e38: Add cells: `assessments`, `assessment_contributors`, `draft_evidence`, `draft_checked_documents` and `review_events`.
  Editors and country admins write draft content; reviewers change only the state and attest quotes; every member
  reads. Also fix `app.localized`, whose check refused SQL NULL, so nullable localized columns can use it.
- 72e2756: Add job requests and the worker's access. The worker sets `app.job_request_id` and acts as the request's requester;
  its RLS shows only that open request and what it names (its tenant, source, the source's copy and pages, its LLM run
  and the run's election), a trigger limits what each job kind may change, and finishing the request ends what it
  authorizes. Requests are made only when their job has something to do, and change only by finishing, once.

## 0.2.0

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
- eaddfe3: Add organizations and brand assets: `organizations`, `tenant_organizations` (one operator per tenant), `brand_assets`
  (PNG, JPEG or WebP up to 2 MB, hash checked), `brand_asset_grants` and `tenant_brand_selections`. Platform admins write
  organizations, links, assets and grants; country admins choose their tenant's selections. Writes to a shared
  organization or asset bump every tenant that shows it, and the audit log no longer copies binary columns.
- 2cd4215: Add the public cache key: `app.public_versions`, one counter per tenant that the public reads (active tenants only)
  and that only the `SECURITY DEFINER` trigger `private.bump_public_version()` moves, on every write to a table the
  public can read. No runtime role can set or rewind it.
- 9208dc8: Add tenancy: `tenants`, `platform_admins` and `memberships` with RLS, and the policy helpers `private.my_tenants()`
  and `private.is_platform_admin()` (aal2 only). The admin shows each user only what is theirs; public-visibility
  policies are for `aiontheballot_web` only. Country admins change only their tenant's theme, report retention and LLM
  cap. The isolation matrix now generates its cases from per-table rules and runs them against shared fixtures.

## 0.1.0

### Minor Changes

- 9a83b4d: Add @aiontheballot/db (Kysely client, withActor, generated types) and the TypeScript quote normaliser in @aiontheballot/domain,
  kept identical to private.normalize_for_match() by parity tests against Postgres.

### Patch Changes

- 300f450: Add the tenant-isolation matrix harness: principals from ADR-0002, a runner that refuses to pass on a missing target,
  a deny that changed data, or an allow touching more than one row, and a completeness test against the `app` schema.
- e13c986: Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
  and the i18n JSON include they required, and write the Vitest configs in TypeScript.
