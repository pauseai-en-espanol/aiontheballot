# @aiontheballot/db

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
