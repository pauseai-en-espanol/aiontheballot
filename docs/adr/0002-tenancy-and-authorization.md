# ADR-0002: Tenancy and authorization

- **Status:** Proposed
- **Date:** 2026-10-08
- **Relates to:** BRIEF §2–4, §8; [ADR-0001](0001-hosting-and-delivery.md)

This ADR assumes only PostgreSQL 18. The framework and auth library are chosen in
[ADR-0003](0003-application-stack.md).

## Context

The comparison table is the product, and motivated adversaries (parties and their supporters) will try to
discredit it. What we protect, in priority order:

1. The integrity of published cells.
2. Draft and review confidentiality.
3. Right-of-reply personal data. This is GDPR data, and the tenant's operator is its controller.
4. Admin accounts.
5. Hostnames printed on circulating share images.

Other operator organisations will join later. No tenant may read or alter another tenant's data.

## Decision

### 1. Three enforcement layers, all in Postgres

The application is never the security boundary. Postgres enforces three layers:

- **Grants** decide which tables and functions a role can touch at all.
- **Row-level security** decides which rows.
- **Constraints and triggers** decide which states and transitions are legal.

The UI repeats some checks, but only for user experience.

### 2. Database roles

| Role            | Used by                         | Notes                                                     |
| --------------- | ------------------------------- | --------------------------------------------------------- |
| `ballot_owner`  | Migration and backup jobs only  | Owns the schemas; never used by the running apps          |
| `ballot_admin`  | API admin routes and the worker | Runtime role                                              |
| `ballot_web`    | API public routes (read-only)   | Runtime role                                              |
| `ballot_worker` | Background worker               | Runtime role; only job tables, scoped to the job's tenant |

All runtime roles are `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB` and own nothing. A catalog
meta-test fails if this ever changes.

### 3. Actor context per transaction

- Only the API (ADR-0003) talks to Postgres. It verifies the session, then runs every database transaction through
  `withActor(actor, fn)`.
- `withActor` sets `SET LOCAL app.user_id` and `SET LOCAL app.aal`.
- `private.current_user_id()` returns NULL when no actor is set, so every member policy **denies by default**.
- `ballot_web` never sets an actor.

**Trust boundary:** the API is trusted to establish _who_ the user is. It is never trusted to decide
_what_ they may do. A compromised API could impersonate users. We accept that risk; the immutable audit
log makes it visible (T23).

### 4. Tenant identity

- Every tenant-owned row has `tenant_id uuid not null`, and a trigger makes it immutable.
- Every child row references its parent through a composite foreign key
  `(tenant_id, parent_id) → parent(tenant_id, id)`.
  A cross-tenant reference therefore cannot be expressed at all.
- This also blocks probing for row IDs in other tenants through FK errors, because FK checks bypass RLS.

### 5. Public and private data never share a table

- Published content lives in immutable snapshot tables: `assessment_revisions`, `revision_evidence` and
  `revision_checked_documents`.
- Drafts, sign-offs, review notes and tokens live in private tables.
- **Storage is tables too:**
  - `app.files(tenant_id, bucket, …)` holds metadata and `app.file_blobs` holds the bytes, under the same RLS.
  - `bucket` is one of `public_assets`, `sources` or `platform_assets`.
  - This is how the brief's "storage buckets under RLS" is met.

### 6. Closed by default

- Migrations revoke everything on schemas, tables **and functions** from `PUBLIC`.
- Default privileges are set so that new functions are not executable by `PUBLIC` either.
- Every grant is explicit.
- Helper functions live in a `private` schema.
- `SECURITY DEFINER` functions are limited to an allowlist: policy helpers, audit triggers, `submit_report` and
  `accept_invitation`. All of them set `search_path = ''`.

### 7. The public role reads, and can call one function

- `ballot_web` can `SELECT` public-capable tables. RLS limits it to published rows in live or archived elections
  of active tenants.
- It can `EXECUTE` `app.submit_report(...)`, which is `SECURITY DEFINER`. The function checks the tenant is
  active, inserts the report with `status='new'`, and enforces a per-tenant daily cap.
- It has no table write grants at all.

### 8. Authorization comes from memberships

- `memberships(user_id, tenant_id, role)`, where `role` is `country_admin`, `editor` or `reviewer`. A user may
  hold several roles.
- `platform_admins(user_id)` is a separate table with no write path from the app.
  - **This deviates from BRIEF §2,** which puts `platform_admin` in `memberships`. It isn't a tenant-scoped role,
    and a nullable `tenant_id` would weaken every policy.
- Policies use the pattern `tenant_id IN (SELECT private.my_tenants(roles))`. Postgres evaluates that subquery once
  per statement, not once per row.

### 9. MFA is enforced in the database

The helpers `my_tenants` and `is_platform_admin` return nothing unless `app.aal = '2'`, meaning the session
completed TOTP. A stolen password alone cannot read private data or publish.

### 10. Invite-only accounts

- Country admins (or platform admins) create rows in `app.invitations(tenant_id, email, role, token_hash,
expires_at)`, under RLS.
- `private.accept_invitation(token)` creates the membership for the current actor if the email matches.
- Self sign-up is off.
- Resetting a user's MFA is a platform-admin runbook.

### 11. Data rules are enforced by table triggers, not by RPCs

- Deferred constraint triggers enforce the evidence requirement, four-eyes review, the verbatim quote match, legal
  status transitions, and `published_by := current_user_id()`.
- Server functions exist only for convenience. A direct `INSERT` or `UPDATE` that skips them is still checked.

### 12. Live elections are change-controlled

- Once an election is `live`, editing criteria text, party name or short name, or the methodology body goes
  through `change_requests`. One member proposes; a different member approves.
- Each approved change also adds a corrections-log entry.
- Programme-status updates need only one person, but are audited and shown publicly with their check date.

### 13. Withdrawal

A revision with `change_kind='withdrawal'` returns the cell to _pending_ and logs a correction.

### 14. Immutability, with one purge path

- Triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on revisions and their child tables, `audit_log` and
  `purge_log`. These triggers fire even for the owner role. The corrections log is a view derived from revisions
  and approved change requests, so it can't be edited either.
- The only exception is `private.purge_tenant(tenant_id)`:
  - Only `ballot_owner` can execute it.
  - It sets a transaction-local `app.purge` flag that the triggers honour, and writes a platform-level purge record.
  - It covers per-tenant deletion (BRIEF §7) and GDPR erasure.
- Personal data is never copied into `audit_log`; reports are logged by ID only.

### 15. The Host header never authorizes

- The public web app has no session code, no DB credentials and sets no cookies.
- The admin runs on one central host (ADR-0003), with the API under `/api/*` on the same host. Sessions use
  host-only `__Host-` cookies with `Secure; HttpOnly; SameSite=Lax`.
- The tenant being administered comes from the URL path (`/t/{slug}/…`), never from the host. Per-tenant admin
  hosts may be added later for that tenant's members; platform admins only ever use the central host.

## Capabilities by role

"Own" means the member's own tenant. A member of tenant A acting on tenant B gets exactly what `ballot_web` gets.

| Capability                                                                                                | editor | reviewer | country_admin | platform_admin                      |
| --------------------------------------------------------------------------------------------------------- | ------ | -------- | ------------- | ----------------------------------- |
| Read own-tenant private data (drafts, sources, queue)                                                     | ✓      | ✓        | ✓             | ✓ all tenants, **except** `reports` |
| Create and edit drafts, evidence and sources; propose live changes                                        | ✓      | –        | ✓             | ✓                                   |
| Approve and publish revisions and change requests (never own work)                                        | –      | ✓        | ✓             | ✓                                   |
| Triage right-of-reply reports                                                                             | ✓      | ✓        | ✓             | –                                   |
| Invite members and manage memberships in own tenant                                                       | –      | –        | ✓             | ✓                                   |
| Tenant theme, election status, methodology **body**                                                       | –      | –        | ✓             | ✓                                   |
| Operator, methodology **kind**, `is_pauseai_chapter`, restricted-asset grants, hostnames, tenant `active` | –      | –        | –             | ✓ (audited)                         |
| Read the audit log                                                                                        | –      | –        | ✓             | ✓                                   |

**About platform admins and reports:** the app never lets a platform admin read reports. A platform admin could
grant themselves a membership to do so, but that grant is audited and visible to the tenant's country admin.

## Public-visibility rule

A row is world-readable only when all of these hold:

- It is in a public-capable table.
- Its election's `status` is `live` or `archived`.
- Its tenant is active.

These platform-wide rows are also public: active `tenants`, verified `tenant_hostnames`, `organizations` and
`core_criteria`.

## Data rules (BRIEF §4), enforced by triggers

### Evidence requirement

- A published rating other than `not_mentioned` needs at least one evidence row with a non-empty verbatim quote.
- `not_mentioned` needs at least one checked-document row: which document was checked, and `checked_at`.

**Verbatim match, for every quote** (not only LLM-proposed ones)

- Every quote must appear in its source document's stored extracted text, after both are passed through
  `private.normalize_for_match()`.
- That normalization only affects matching; the quote is always displayed exactly as stored. It:
  - applies Unicode NFKC, which expands ligatures such as "ﬁ";
  - removes soft hyphens;
  - re-joins words hyphenated across line breaks;
  - folds typographic quotes and dashes;
  - collapses whitespace.
- A TypeScript port of the function is tested against the same fixture file, so the UI and the database agree.
- **Exception:** sources with no extractable text (scans, video) can use `match_status='attested'`. That requires a
  stored file, and the attester must be someone other than the publisher.

### Evidence source kinds

- Each source document has a `kind`: `pdf`, `web_page`, `social_post`, `video`, `audio` or `party_submission`.
- Each piece of evidence has a generic **locator**:
  - a page or section for documents;
  - an anchor for web pages;
  - a start and end timestamp for video and audio.
- `pdf` and `web_page` sources are **verbatim-matched** automatically against their extracted text.
- Social posts, video and audio use the **attested** path: a stored screenshot or clip, plus a second person.
- The public page shows whether each quote was matched or attested.
- `party_submission` is for the future party questionnaire. The schema supports it now; the feature comes later.
- Which kinds a tenant's table accepts is a **methodology setting**, chosen by the operator.

### Four-eyes review

- The publisher must hold `reviewer` or `country_admin`.
- The publisher must not be among the revision's **contributors**: anyone who edited it since the last publish.

### History and corrections

- Every publish after the first carries `change_kind` (`update`, `correction` or `withdrawal`) and a public,
  localized note.
- Each such publish appends to the election's corrections log.
- A cell's "last updated" date is the time of its latest revision.

### "Pending" is not "not mentioned"

- A cell with no published revision shows a non-rating _pending_ state.
- "Not mentioned" is an actual rating, backed by a record of which documents were checked and when.

## Platform invariants (BRIEF §3)

- **Exactly one operator per tenant.** A partial unique index allows at most one; a deferred check requires one
  before the tenant can be made active.
- **Only platform admins change a tenant's operator or methodology kind.** A trigger enforces this, and every such
  change is audited.
- **Demands methodologies name their owner:** `CHECK ((kind = 'demands') = (demands_owner_id IS NOT NULL))`.
- **Restricted brand assets** (such as the PauseAI logo):
  - A tenant can select one only if its operator has `is_pauseai_chapter = true` **and** a platform admin has
    granted that asset to the tenant.
  - Revoking the grant, or changing the operator, re-checks the selection.
  - The shared layout re-checks again when rendering.

## Hostnames

### Schema

- `tenant_hostnames(hostname pk, tenant_id, is_canonical, verified_at, retired_at, created_at)`.
  - `hostname` is lowercase ASCII (punycode for IDNs), with no port and no trailing dot.
  - A partial unique index on `(tenant_id) WHERE is_canonical` allows at most one canonical hostname per tenant.
  - `CHECK (NOT is_canonical OR verified_at IS NOT NULL)`: only a verified hostname can be canonical.
- Hostnames are never deleted. Both the grants and a trigger prevent it.
- Reserved platform hostnames (the admin host, the platform domain itself) are listed in `platform_hostnames` and
  can never be claimed by a tenant. Subdomains of the platform domain (e.g. `es.<platform-domain>`) can be
  assigned to a tenant like any other hostname.
- Only platform admins can write hostnames.
- DNS TXT verification tokens live in a separate private table, `hostname_verifications`.

**Operations:** a hostname gets its gateway route and certificate SAN through a gitops PR (ADR-0001), and only
after `verified_at` is set. Neither is ever removed.

### How a tenant is reachable, and its canonical address

The slug is mandatory: it is the tenant's internal identifier (admin URLs, config, logs). **Public addresses are all
optional**, and a tenant may use any combination:

1. its own domain or domains, e.g. `iaenlasurnas.es`;
2. a subdomain of the platform domain, e.g. `es.<platform-domain>` (a `tenant_hostnames` row like any other);
3. a path on the platform domain, `<platform-domain>/{slug}/…`. This works whenever a platform domain is configured,
   and 301-redirects to the canonical hostname if the tenant has one.

The platform domain itself is optional configuration; the Spain pilot runs without one.

**At most one canonical hostname.** This changes the brief, which says "exactly one". A tenant reachable only by
path has no hostname of its own, and the platform domain can't be listed under several tenants because the hostname
is the primary key.

- A tenant with no canonical hostname has canonical base URL `https://{platform-domain}/{slug}`.
- A tenant with neither a canonical hostname nor a configured platform domain is not publicly reachable.
- `canonicalBase(tenant)` is the only source for `rel=canonical`, OG and share URLs, sitemaps and the URL printed
  on images.
- The request's `Host` header is never echoed back.

### Routing

Routing is a pure function, `resolve(host, path, query, hostMap, config)`, that returns serve, a 301 redirect, or
404:

1. Normalize the host: lowercase, strip the port and any trailing dot, convert IDNs.
2. If the host is a platform host and the path is `/{slug}/…`:
   - unknown slug → **404**;
   - the tenant has a canonical custom host → **301** to it, same path and query;
   - otherwise → serve.
3. A verified alias hostname → **301** to `canonicalBase`, same path and query.
4. The tenant's canonical hostname → serve.
5. Anything else, including unverified hostnames → a generic **404**. There is never a fallback to a default
   tenant.

**When serving:**

- Requests are rewritten to an internal path that includes the tenant, so render caches can never mix tenants.
- Incoming requests that already target that internal path prefix get 404.
- Static asset paths are excluded from the rewrite.
- The exact mechanics depend on the framework (ADR-0003).

## Threat model (cross-tenant focus)

### Actors

| ID  | Actor                                                            |
| --- | ---------------------------------------------------------------- |
| A1  | Anonymous internet user, including motivated party staff         |
| A2  | Authenticated user with no membership                            |
| A3  | Member of another tenant (B)                                     |
| A4  | Compromised country admin of B                                   |
| A5  | A single compromised editor in A                                 |
| A6  | A platform admin who errs or is compromised                      |
| A7  | Attacker with control over DNS or a domain                       |
| A8  | Hostile content: party PDFs and HTML, including prompt injection |
| A9  | Supply chain or CI compromise                                    |
| A10 | Compromised API                                                  |

### Threats

| #   | Threat                                                                     | Actor  | Mitigation                                                                                                          | Proven by                             |
| --- | -------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| T1  | Read B's drafts, sources, reports or audit log                             | A2–A4  | Membership-based RLS; `ballot_web` has no grants on private tables                                                  | Matrix                                |
| T2  | Write into B by forging `tenant_id`                                        | A3–A4  | `WITH CHECK` on membership                                                                                          | Matrix                                |
| T3  | Reference across tenants (A's evidence or source on B's cell)              | A3     | Composite FKs                                                                                                       | DB-rule tests                         |
| T4  | Move a row from one tenant to another                                      | A3–A4  | Immutability trigger plus composite FK                                                                              | DB-rule tests                         |
| T5  | Escalate privileges (gain a role in A, or platform admin)                  | A4     | Policies on memberships and invitations; `platform_admins` has no app write path                                    | Matrix                                |
| T6  | Claim A's hostname, or a domain the attacker doesn't own                   | A4, A7 | Hostname primary key; TXT verification; platform-admin-only writes; gitops PR only after verification               | Routing and DB tests                  |
| T7  | Spoof the Host header to mix branding or poison a cache                    | A1     | Host only selects content; tenant is in the internal path; internal prefix blocked; absolute URLs built from the DB | Routing integration tests             |
| T8  | Sessions or authorization appearing on public hosts                        | A1     | Public app has no session code; one admin host                                                                      | E2E: no `Set-Cookie` on public hosts  |
| T9  | Read or overwrite another tenant's files                                   | A3     | RLS on `app.files` and `file_blobs`; tenant is part of the key                                                      | Matrix and endpoint integration tests |
| T10 | A `SECURITY DEFINER` function or function grant leaks access               | —      | Allowlist; `search_path=''`; `EXECUTE` revoked from `PUBLIC`                                                        | Catalog meta-tests                    |
| T11 | A runtime role drifts into ownership or `BYPASSRLS`                        | —      | Role-attribute meta-test                                                                                            | Catalog meta-tests                    |
| T12 | The database is exposed outside the cluster                                | A1     | ClusterIP only; no NodePort                                                                                         | Deploy check                          |
| T13 | Secrets leak                                                               | A9     | SealedSecrets; CI holds no cluster credentials (GitOps pull); no `pull_request_target`                              | CI review                             |
| T14 | One compromised editor publishes a false rating                            | A5     | Four-eyes; MFA (aal2); audit log; public corrections                                                                | DB-rule tests                         |
| T15 | One person uses a second ("sock-puppet") account to pass four-eyes         | A5     | Invite-only accounts vetted by the country admin; audit trail. **Residual risk accepted**                           | Process                               |
| T16 | Platform admin abuses access                                               | A6     | Few admins, all with MFA; changes audited; no reading `reports` in the app                                          | Matrix and invariant tests            |
| T17 | An ineligible tenant uses a restricted brand asset                         | A4     | DB check plus render-time check                                                                                     | Invariant tests                       |
| T18 | Stored XSS through quotes, party names or methodology                      | A3, A8 | Render as text only; sanitized Markdown; CSP                                                                        | Unit and E2E tests                    |
| T19 | Prompt injection in a programme sways the LLM's suggestions                | A8     | LLM only suggests; unmatched quotes dropped; humans decide with four-eyes; LLM has no tools                         | M4 tests                              |
| T20 | Report spam or denial of service                                           | A1     | A single function as the only write path; per-tenant cap; honeypot; Envoy per-IP rate limit                         | Integration tests                     |
| T21 | A retired or alias domain expires and someone else buys it                 | A7     | Association-owned registrar with auto-renew; hostnames never deleted or detached; uptime monitor per hostname       | Ops checklist                         |
| T22 | Per-tenant export or purge touches another tenant                          | —      | Owner-only `purge_tenant`; tenant-scoped export                                                                     | Integration tests                     |
| T23 | Compromised API impersonates users                                         | A10    | Accepted. Small admin surface; immutable audit log; MFA; alert on unusual publish volume                            | Audit review                          |
| T24 | A live criterion is reworded, changing what already-published ratings mean | A5     | Change requests need four-eyes and create a corrections entry                                                       | DB-rule tests                         |

## Test matrix (BRIEF §8)

The matrix proves tenant isolation at the database level.

### Harness

The harness uses Vitest (via `@slango.configs/vitest`) and `pg`, against Postgres 18. ADR-0003 decides whether
that Postgres is a service container or embedded binaries.

Each case runs in its own transaction, which is rolled back afterwards:

1. Switch role: `SET LOCAL ROLE ballot_web` or `ballot_admin`.
2. Set the actor context: `set_config('app.user_id', …, true)` and `set_config('app.aal', …, true)`.
3. Run the operation.
4. Classify the result:
   - **Allow:** exactly the expected row is visible, or exactly one row changed.
   - **Deny:** a permission error, a `WITH CHECK` violation, or 0 rows visible or affected.
5. For every deny case, the harness also checks two things as the owner role:
   - **Before** the operation, the target row exists. Without this, a missing fixture would pass as a "deny".
   - **Afterwards**, nothing changed.

### Fixtures

All fixture data is fictional:

- Two tenants, `test-a` and `test-b`. Each has:
  - a live, a draft and an archived election;
  - a draft, an `in_review` and a published cell;
  - parties ("Partido Ejemplo A", "Partido Ejemplo B") and criteria;
  - a source file, a report and an invitation.
- One inactive tenant that still has a live election.
- Unverified and retired hostnames.

### Dimensions

Expected outcomes are written as data in `db/tests/rls/matrix.ts`, and the individual test cases are generated
from it.

- **Principals:**
  - `ballot_web` (the API's public routes);
  - `ballot_admin` with no actor set;
  - a user with no membership;
  - editor@A, reviewer@A, country_admin@A and platform_admin, **each at aal2 and at aal1**;
  - a user who is editor in A and reviewer in B;
  - a member whose membership was just revoked.
- **Target tenant:** own, other, or platform-wide.
- **Row state:** published in a live election, archived, draft, `in_review`, or belonging to an inactive tenant.
- **Operations:**
  - select, insert, update and delete;
  - plus **column-level updates** of sensitive columns: `status`, `author_id`, `published_by`, `tenant_id`,
    `tenants.active` and `methodologies.kind`.
- **Relations:** every table and view in `app.*`, plus **every function a runtime role can execute**. The
  authoritative list is [the data model spec](../spec/data-model.md) (and, once they exist, the migrations). The
  catalog meta-test fails if `matrix.ts` and the database disagree.

### Expected outcomes by table class

Exceptions are listed in `matrix.ts`.

| Principal                                                      | Public-capable, own, published      | Public-capable, own, draft or in_review  | Private, own                                                | Any row of another tenant            | Immutable tables                 |
| -------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------ | -------------------------------- |
| `ballot_web`, no actor, no membership, or **any role at aal1** | Read only                           | Deny                                     | Deny                                                        | Published: read only. Otherwise deny | Read published only; never write |
| editor@A, aal2                                                 | Read; cannot change status directly | Read, insert and update; delete drafts   | Read; write sources; triage reports                         | Same as `ballot_web`                 | Read; never update or delete     |
| reviewer@A, aal2                                               | Read                                | Read; approve or reject (never own work) | Read; triage reports                                        | Same as `ballot_web`                 | Read; never update or delete     |
| country_admin@A, aal2                                          | Read                                | Full access to drafts                    | Full, including invitations and memberships; read audit log | Same as `ballot_web`                 | Read; never update or delete     |
| platform_admin, aal2                                           | All tenants                         | All tenants                              | All, **except `reports`**                                   | All tenants                          | Read; never update or delete     |

### Catalog meta-tests

These fail when someone adds a database object without wiring it in:

1. Every `app.*` table has RLS enabled.
2. Every `app.*` table and every executable function appears in `matrix.ts`, and nothing listed there is stale.
3. Every table with a `tenant_id` has the immutability trigger and composite FKs.
4. The runtime roles own nothing and have neither `BYPASSRLS`, `CREATEROLE` nor superuser.
5. `ballot_web` has no `INSERT`, `UPDATE` or `DELETE` grant anywhere.
6. `EXECUTE` grants match the allowlist, and no function is executable by `PUBLIC`.
7. Every `SECURITY DEFINER` function is on the allowlist and sets `search_path`.
8. Every view is `security_invoker`, and there are no materialized views.
9. Every immutable table has its `UPDATE`, `DELETE` and `TRUNCATE` triggers.

### Data-rule and invariant tests

Each of these must fail:

- Publishing without evidence, including through a direct `INSERT` that skips the server function.
- Publishing `not_mentioned` without a checked-documents record.
- Self-review, including by someone who only co-edited the revision.
- Review by a reviewer from another tenant.
- Review by a reviewer at aal1.
- Publishing a quote that doesn't match its source text.
- `UPDATE`, `DELETE` or `TRUNCATE` on an immutable table.
- Running `purge_tenant` as any role other than the owner.
- Editing a criterion in a live election without an approved change request.
- A country admin changing the operator or the methodology kind.
- Anyone other than a platform admin setting `is_pauseai_chapter`.
- An ineligible tenant selecting a restricted brand asset.
- A duplicate hostname.
- A second canonical hostname for the same tenant.
- An unverified canonical hostname.
- Deleting a hostname.

And each of these must succeed:

- Quotes whose PDF text contains ligatures or line-break hyphenation.
- `purge_tenant` run as the owner role.
- Every permitted operator or kind change, which also writes an audit row.

### Routing tests

**Unit tests**, table-driven, against `resolve()`:

- Unknown host → 404.
- Unverified host → 404.
- Alias → 301 with the same path and query.
- Platform `/{slug}` → 301 when the tenant has a custom canonical host.
- Edge cases: ports, mixed case, a trailing dot, IDNs, and `www.`

**Integration tests** against staging:

- Status codes and `Location` headers are correct.
- A spoofed `X-Forwarded-Host` has no effect.
- The internal path prefix returns 404.
- No `Set-Cookie` header is ever sent on public hosts.

### Platform-invariant tests

- A crawler visits every URL in the sitemap, plus the 404 page, the report form and archived elections. On each
  page it checks for the "An initiative of {operator}" line and the methodology link.
- Every share-image template is rendered to SVG, and the test checks that `canonicalBase` appears in it as text.

## Consequences

**Benefits:**

- Isolation lives in one place and is proven by generated tests plus completeness checks.
- There is no public Data API.
- Every database object is closed until explicitly opened.

**Costs:**

- More SQL. Volunteers must follow the new-table checklist in CONTRIBUTING.md.
- MFA adds friction for volunteers. Accepted: one stolen password must not be enough to publish.
- Snapshot tables duplicate some data. That is deliberate, so published history can't change.
