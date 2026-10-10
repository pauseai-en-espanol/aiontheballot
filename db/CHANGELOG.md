# @aiontheballot/migrations

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
  Secrets and the Harbor pull secret exist, and still before the new pods roll out.
