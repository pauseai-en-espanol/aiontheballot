# ADR-0002: Tenancy and authorization

- **Status:** Proposed
- **Date:** 2026-10-08
- **Relates to:** BRIEF §2–4, §8; [ADR-0001](0001-hosting-and-delivery.md),
  [ADR-0004](0004-file-bytes-on-a-volume.md) (file bytes)

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

| Role                    | Used by                                                                                                                                                                                                                           | Notes                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `aiontheballot_owner`   | The migration Job only                                                                                                                                                                                                            | Owns the schemas; never used by the running apps                                                               |
| `aiontheballot_admin`   | API admin routes                                                                                                                                                                                                                  | Runtime role                                                                                                   |
| `aiontheballot_web`     | API public routes (read-only)                                                                                                                                                                                                     | Runtime role; `SELECT` on public-capable tables and columns (§7), `USAGE` on `app` only (PLAN R169)            |
| `aiontheballot_worker`  | Background worker                                                                                                                                                                                                                 | Runtime role; only job tables, scoped to the one open `job_requests` row it runs (`app.job_request_id`)        |
| `aiontheballot_auth`    | Better Auth, inside the API; members' names and emails for the members RLS shows (PLAN R94); invited accounts (PLAN R114); the daily sign-in clean-up; the owner's account and authenticator-reset commands (PLAN R90, R93, R156) | Runtime role; only Better Auth's tables in the `auth` schema, nothing in `app` or `private`                    |
| `aiontheballot_sweeper` | The scheduled sweep of orphaned bytes (PLAN R117, R141)                                                                                                                                                                           | Runtime role; executes `private.file_sweep_list()` and nothing else                                            |
| `aiontheballot_preview` | The API's preview routes, for the admin's preview of a site (PLAN R181)                                                                                                                                                           | Runtime role; reads what `aiontheballot_web` reads, and elections in preview (§7); no write or `EXECUTE` grant |

All runtime roles are `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB` and own nothing. A catalog
meta-test fails if this ever changes.

**Credentials stay with their own role** (editorial workflow spec, O2, decided by Dani). Better Auth's tables hold
accounts, password hashes, TOTP secrets and sessions. They live in the `auth` schema (or, should Better Auth's
adapter need it, another schema of their own: never `app` or `public`), owned by `aiontheballot_owner`, and only
`aiontheballot_auth` is granted on them, so no query run as `aiontheballot_admin`, `aiontheballot_web` or
`aiontheballot_worker` can reach a credential. They hold no tenant data (one account can belong to several tenants),
so grants keep them apart rather than RLS. The API keeps two pools: Better Auth's, which establishes who the user
is, and the admin role's, which runs everything they do through `withActor` (§3). What the app needs from `auth`, the
verified email an invitation checks, comes through `private.accept_invitation` (§10, already on the allowlist).
Amended (PLAN R202, [ADR-0008](0008-member-tokens-for-tools.md)): a member's tokens for tools are credentials too,
so `auth.member_tokens` lives beside Better Auth's tables, under the same rule: no tenant data, only
`aiontheballot_auth` granted on it (minting and reading, then marking used or revoked).
Amended (PLAN R114): invitations also use Better Auth's pool to ask whether an invited email has an account, and to
create an invited person's account with that email verified, as Better Auth's sign-up would.
`private.pending_invitation` runs on the admin pool without an actor, since whoever holds the link is nobody yet; it
reads only the invitation that token names, and since PLAN R199 that invitation's site (§10). Members'
names and emails are read through Better Auth's pool by account id, only for the memberships RLS has just shown the
actor in their `withActor` transaction, and the API gives emails only to country admins and platform admins (PLAN
R94).
Catalog meta-tests keep `aiontheballot_auth` out of `app` and `private`, and no runtime role is a member of another
role.
Amended (PLAN R117, R141): the sweep of orphaned bytes (ADR-0004 §5) runs on a schedule as `aiontheballot_sweeper`, a
login provisioned with the database like the others. It reads nothing directly: its one grant is
`private.file_sweep_list()` (§6), and it mounts the file volume as the API does.
Amended (PLAN R181): the admin's preview of a site (ADR-0005) reads as `aiontheballot_preview`, a login provisioned
with the database like the others, which the API uses only for its `/preview` routes: those answer only a request
carrying the secret the admin and the web app share, which only the web app's preview host sends. The role reads
exactly the columns `aiontheballot_web` reads (its grants were copied from that role's, and a catalog test keeps the
two equal), under a policy of its own beside each of the public role's, which also admits elections in preview (§7);
it writes nothing and executes no function. A bug in the preview's routes, or a leaked secret, exposes elections in
preview at most: never a draft's content, nor anything private.
Amended (ADR-0007, PLAN R175): the fetcher, which alone reaches the internet (copies by URL, archive snapshots), has
no database login at all. A copy it fetches is stored by the API as the requester's upload, so four-eyes counts them
as for any upload; a snapshot is recorded by `aiontheballot_worker` under its existing `archive_source` job scope. No
role, grant or definer function was added (threat T29).

### 3. Actor context per transaction

- Only the API (ADR-0003) talks to Postgres. It verifies the session, then runs every database transaction through
  `withActor(actor, fn)`.
- `withActor` sets `SET LOCAL app.user_id` and `SET LOCAL app.aal`.
- `app.aal` is `'2'` only for a session a second factor created: Better Auth's database hook records it in
  `auth.sessions.aal` when a TOTP or backup code opens the session, and a session a password alone opened stays at 1
  for life (PLAN R84). The API gives any session short of aal2 no actor at all.
- `private.current_user_id()` returns NULL when no actor is set, so every member policy **denies by default**.
- `aiontheballot_web` never sets an actor.

**Trust boundary:** the API is trusted to establish _who_ the user is. It is never trusted to decide
_what_ they may do. A compromised API could impersonate users. We accept that risk; the immutable audit
log makes it visible (T23).

Amended ([ADR-0008](0008-member-tokens-for-tools.md), PLAN R202): a request may also carry a member's token, which
they mint for a tool while signed in with their second factor. The API then sets `app.token_id` beside the actor;
through it every table refuses writes except those drafting needs (`private.needs_a_person`), and the audit log
names the token.

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
  - `app.files(tenant_id, bucket, …)` holds each file's row under RLS; its bytes are on the file volume, read only
    for a row RLS shows and only from that row's own tenant and bucket ([ADR-0004](0004-file-bytes-on-a-volume.md)).
    A row can't reach another tenant's or another bucket's bytes by naming their hash.
  - `bucket` is `public_assets` or `sources`. Platform brand assets live in their own table, `brand_assets`.
  - This is how the brief's "storage buckets under RLS" is met: each file's row is under RLS, and its bytes are
    reached only through a row the reader can see (ADR-0004).

### 6. Closed by default

- Migrations revoke everything on schemas, tables, **functions and types** from `PUBLIC`.
- Default privileges are set so that new functions are not executable by `PUBLIC`, and new types not usable by it.
- Every grant is explicit. Amended (PLAN R135): a site's public settings, `tenants.site_open`, `search_indexing` and
  `plausible_script`, are readable by `aiontheballot_web` (with the routing data, for active sites only, as RLS has it)
  and updatable by `aiontheballot_admin`, where `members_may_change` keeps them a platform admin's. Amended (PLAN
  D16, R157): `assessments.draft_report_id`, the report a cell's draft answers, is updatable by `aiontheballot_admin`;
  `restrict_columns` keeps it to editors and country admins, a trigger running as the writer refuses a change by
  someone who can't read the report named before or after it (so a platform admin neither sets nor clears one, P11)
  and a report of another election, and the publish trigger copies it into `revision_internal.report_id`. Amended
  (PLAN D14, R172): `source_documents.replaced_at`, a source's "replaced" mark, is updatable by `aiontheballot_admin`
  (RLS keeps it to editors, country admins and platform admins), set once by the source's trigger, which takes the
  time itself; never readable by `aiontheballot_web`.
- Helper functions live in a `private` schema.
- `SECURITY DEFINER` functions are limited to an allowlist: policy helpers, audit triggers, the public-cache trigger
  `bump_public_version` (so no runtime role can write `public_versions`), `submit_report`, the signup list's
  `sign_up`, `confirm_signup` and `unsubscribe` (amended, PLAN R119, R122), the invitations' `pending_invitation` and
  `accept_invitation` (amended, PLAN R114), the publish trigger `publish_revision` and `anonymize_expired_reports`
  (worker only), and the sweep's `file_sweep_list` (amended, PLAN R117, R141). All of them set `search_path = ''`.
- The actor helpers (`private.current_user_id`, `private.current_aal`) and the policy helpers
  (`private.my_tenants`, `private.is_platform_admin`) are executable by `aiontheballot_admin`, whose policies and
  triggers call them.
- `private.pending_invitation` and `private.accept_invitation` are executable by `aiontheballot_admin` only (§10).
- `private.normalize_for_match` is executable by `aiontheballot_admin` (the match trigger) and
  `aiontheballot_worker` (the generated column on `source_texts`).
- The worker may also execute `private.current_user_id`: it sets `app.user_id` to its job request's requester, so what
  it writes is stamped and audited as theirs, and its policies accept no one else.
- `private.file_sweep_list` is executable by `aiontheballot_sweeper` only: every tenant's file keys, brand assets'
  hashes and when rows stopped naming bytes (from the audit log), as lines for the sweep, and nothing else. The
  function's owner is the tables' owner, which RLS doesn't filter (no table forces it). Its grant is applied by the
  migration once the role exists, and by the owner when the role is provisioned later. A leaked login learns which
  bytes exist (tenant, bucket and hash), so also the ids of tenants not yet public, and when rows stopped naming
  some, so roughly when a tenant was active: never a file's contents, name or uploader. Every relation the function
  reads is schema-qualified, catalogs included, since with an empty `search_path` Postgres still looks in a session's
  temporary schema first for an unqualified one.
- `app.submit_report`, `app.sign_up`, `app.confirm_signup` and `app.unsubscribe` are executable by
  `aiontheballot_web` only, and `private.anonymize_expired_reports` by `aiontheballot_worker` only (all `SECURITY
DEFINER`, on the allowlist above).

### 7. The public role reads, and can call four functions

- `aiontheballot_web` can `SELECT` public-capable tables. RLS limits it to published rows in live or archived elections
  of active tenants, plus the row of an announced draft election (see the public-visibility rule).
- Amended (PLAN R169, from the RLS review's D17c): column grants leave out the columns of a public-capable table the
  public doesn't need (`tenant_documents.created_by`, who wrote a policy text, beside the settings and private columns
  of `tenants`, `elections`, `files` and `source_documents`); `organizations` is still read whole (PLAN D18).
  `hostname_tombstones` is not the public's (a purge may tombstone hostnames that never were public), and the role
  has no `USAGE` on `private`: nothing it reads calls a helper there, and the four functions below run as their
  owner.
- It can `EXECUTE` `app.submit_report(...)`, which is `SECURITY DEFINER`. The function checks the tenant is
  active, inserts the report with `status='new'`, and enforces a per-tenant daily cap.
- **The signup list** (amended, PLAN R119, R122): it can `EXECUTE` `app.sign_up`, `app.confirm_signup` and
  `app.unsubscribe`, each `SECURITY DEFINER`, the only way to `app.signups`, which it can't read. They take a token's
  SHA-256, never the token, and act only on the site they name. `sign_up` takes an address only for an active tenant
  with a published privacy policy, in one of its languages, and returns whether to send a confirmation email: first it
  counts the signup and checks the tenant's daily cap, the same for every address, so neither tells anyone who is
  listed; then never for a confirmed address, nor more than once every 10 minutes or 5 times in all to one mailbox
  (its `+tag` variants, and a Gmail address's dotted ones, included). `confirm_signup` confirms the site's
  unconfirmed signup holding the token; `unsubscribe` deletes the site's signup holding it, confirmed or not. Each
  first deletes the signups unconfirmed 7 days after they were made. Country admins and platform admins read every
  column of `app.signups` but the address, the mailbox and the token (column grants), so the admin shows counts and no
  runtime role reads an address.
- It has no table write grants at all.
- **The preview's role** (amended, PLAN R181): `aiontheballot_preview` has the same `USAGE` and `SELECT` grants
  (copied, and kept equal by a catalog test), and a `preview_read` policy beside each `public_read` one, admitting
  what that one admits and elections in preview too: their methodology, reviewers, parties, criteria, published
  revisions and what those cite, and their parties' logos. It executes none of the four functions (the preview strips
  forms) and writes nothing. The public role's policy on `elections` now admits an announced election's own row while
  it is in preview, as while it is a draft.

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
completed TOTP. A stolen password alone cannot read private data or publish. Amended (PLAN R156): an aal2 session can
be written only for an account whose second factor exists, its row locked meanwhile (a trigger on `auth.sessions`,
running as Better Auth's role), so the reset of a lost authenticator (§10) can't leave one behind.

What it rests on (PLAN R166, from the RLS review's D17): `app.user_id` and `app.aal` are the API's word. `withActor`
sets them from the session it checked, and the database trusts them, so whoever holds the admin role's credential, or
an injection in an admin route, could act as any user at aal2: an accepted risk (T23). The database enforces that
private data needs an aal2 actor; that the actor really completed TOTP is the API's check. A later step could have the
database check a session token's hash against `auth.sessions` (a new definer helper: this ADR would be amended).

Amended (PLAN R170): password recovery (§10) never lowers the second factor. A link to choose a new password goes
only to an account that has one, and changes only the password: the account's TOTP and backup codes stay, every
session ends, and the next sign-in asks for a code again, so whoever reads a member's email gets an aal1 session at
most, which the database gives nothing. An account still to enrol (an invitation accepted but enrolment never
finished, or an authenticator the owner just reset) gets no link by email: whoever set its new password would enrol
it. Its person's way back is the owner's command, after an identity check (amended, D19, §10).

### 10. Invite-only accounts

- Country admins (or platform admins) create rows in `app.invitations(tenant_id, email, role, token_hash,
expires_at)`, under RLS.
- Amended (PLAN R114, D10): two narrow `SECURITY DEFINER` functions, for `aiontheballot_admin` only, each taking the
  token's SHA-256 (hex), never the token, which so stays out of the database's logs:
  - `private.pending_invitation(token_hash)` returns the email and role of a pending, unexpired invitation, and
    nothing for any other hash, so the acceptance page can say what is offered and the API can create the account
    with that email. No runtime role reads `app.invitations` otherwise without being the tenant's country admin or a
    platform admin. Amended (PLAN R199): it also returns the invited site's display name, in every language it has
    and as it is now, and the site's main language, so the page names where its holder is joining. Nothing else of
    the site, and only the invitation's own site, which its email named already (in one language, as it was then).
    Same argument, owner, search path and grant.
  - `private.accept_invitation(token_hash)` accepts it for the current actor only if the actor's account
    (`auth.users`, which no runtime role reads) has the invited email, verified; it adds the membership (holding the
    role already is no refusal) and marks the invitation accepted through its transition trigger, at aal1 too: the
    membership grants nothing until TOTP (§9). It answers whether it accepted.
- The API makes an invited person's account itself, as `aiontheballot_auth`, with the invited email marked verified
  (following the link proves it) and the password they chose, and accepts at once; signing in and enrolling TOTP
  follow. An existing account accepts once signed in. The token is in the link's fragment, the acceptance endpoints
  are rate-limited per visitor, and every token that names no pending invitation gets one answer.
- Self sign-up is off.
- Resetting a user's MFA is an owner-run command (amended, PLAN R156): `reset-authenticator.js`, in an API pod, as
  `aiontheballot_auth` with the grants it already has, removes the account's TOTP secret and backup codes, ends its
  sessions and forgets its unused links to choose a password (which go only to an account with its second factor;
  PLAN R179), once the operator has typed the account's address twice and confirmed; the next sign-in enrols again.
  No new role, grant or function to execute; its runbook is incidents §5a.
- **Password recovery** (amended, PLAN R166, R170). Two ways to a link that sets a new password, both through Better
  Auth's own reset (`/request-password-reset`, `/reset-password`), as `aiontheballot_auth` with the grants it already
  has; no new role, grant or function:
  - "I forgot my password" on the sign-in page. The answer is the same whether or not the address has an account, and
    the email goes out after it, so its words never tell and its sending doesn't show in the timing (a lookup's small
    difference remains, behind Better Auth's per-visitor limit). An account is sent one link every 15 minutes at most:
    a link made while another made within that time is unused is forgotten, and of two made at once exactly one goes
    out (their checks take turns on the account's row, PLAN R179), so asking often (or twice at once) neither floods
    the mailbox nor holds a link back for good.
  - "Send a password reset email" in Members, for whoever manages the site's members (its country admins and platform
    admins; the database decides, since RLS lets only them lock the tenant's row) and for its members only. They never
    see the link or the password: the member gets the email, which names who sent it, and chooses the password. The
    answer says whether the member has no second factor yet, or was sent a link in the last 15 minutes (by anyone):
    a manager learns that much of their own members.
  - The link is single use, valid for an hour, carries its token in the fragment (never sent to a server or kept in a
    log), and is stored only as the token's SHA-256. By email it goes only to an account with its second factor (§9).
    Setting a password ends every session and every other link of the account, keeps its second factor, and emails
    the account a notice that it changed. A lost authenticator stays the owner's command above.
  - A member with a password and no second factor who forgot it (amended, D19, PLAN R186): no email goes to such an
    account, since whoever reads the mailbox would get the account. The owner's `create-account.js`, in an API pod as
    `aiontheballot_auth` with the grants it already has, prints the account's id and a read-only query of its roles;
    once the owner has run it and someone entitled to (a country admin of every site where the account is a country
    admin, else of a site in the list; for a platform admin, another platform admin or the coordinator) has confirmed
    the person, reached by a channel the operator knows independently, the operator types the address again and
    `link`. The command then clears the old password, ends the account's sessions and earlier links, and prints a
    link that sets a new password, which the operator gives to the person directly, never through whoever asked nor
    to the mailbox (incidents §5b). Never for an account with a second factor, enrolled or stored. No new role, grant
    or function.

### 11. Data rules are enforced by table triggers, not by RPCs

- **Publishing is one INSERT naming the cell and the version reviewed.** Its trigger checks the review rule, the
  evidence requirement and the verbatim match, and copies the reviewed draft itself; the caller can't supply
  published content, and runtime roles can't write the revision tables any other way.
- Other triggers enforce legal state transitions, the content lock while a cell is in review, actor columns and
  event timestamps (set from the session, never from the caller).
- Server functions exist only for convenience. A direct `INSERT` or `UPDATE` that skips them is still checked.

### 12. Live elections are change-controlled

- Once an election is `live`, editing criteria text, party name or short name, or the methodology body goes
  through `change_requests`, always with a public note.
- **Who approves is a per-tenant setting** (`tenants.live_edits_need_second_approver`, set only by platform admins).
  Off by default: with one or two maintainers, one member may propose and approve their own change. On: a different
  member must approve. The approver always holds `reviewer` or `country_admin`.
- Additions and retirements of parties, criteria and methodology reviewers go through change requests too; once
  live, nothing structural is deleted.
- A decided change request is immutable, and its "before" value is read from the target, never from the caller.
- The edit is accepted only if a matching request was approved in the same transaction. There is no session flag
  that turns the rule off.
- Each approved change writes an immutable public record (`structural_changes`) that the corrections log reads, so
  live changes are public whichever setting applies.
- The approver applies the change with their own rights, in the approving transaction; the public record is inserted
  by the same trigger (its insert policy admits only writes at trigger depth > 0).
- Programme-status updates need only one person, but are audited and shown publicly with their check date.
- Amended (PLAN R181): an election may go to **preview** before it goes live (draft → preview → live, or draft →
  live). In preview the public sees none of it, so nothing is change-controlled: its structure is edited, added to and
  deleted as a draft's, and it takes no change requests. Its cells are published through the same review (four-eyes
  included), and each revision records that it was published in preview, so the corrections log starts when the
  election goes live (`went_live_at` is set then, never in preview). Going live checks again what entering preview
  checked, which edits in preview may have undone. Neither step goes back.

### 13. Withdrawal

A withdrawal is a draft (`draft_change_kind = 'withdrawal'`) reviewed like any other change. Its revision leaves the
cell without a rating (_withdrawn_, distinct from _pending_) and logs a correction with its public note.

### 14. Immutability, with one purge path

- Triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on revisions and their child tables, `structural_changes`,
  `review_events`, `audit_log` and `purge_log`. These triggers fire even for the owner role. The corrections log is
  a view over revisions and `structural_changes`, so it can't be edited either.
- Stored files are immutable, and deletable only while nothing references them. A purge deletes the tenant's bytes
  from the file volume with `purge-tenant-files`, after the rows (ADR-0004).
- The only exception is `private.purge_tenant(tenant_id)`:
  - Only `aiontheballot_owner` can execute it.
  - It sets a transaction-local `app.purge` flag that the triggers honour, and writes a platform-level purge record.
  - It covers per-tenant deletion (BRIEF §7) and GDPR erasure.
- Personal data is never copied into `audit_log`. A report's entries keep its non-personal columns (its kind, cell,
  status, triage and whether a party representative sent it), never its reporter's details or words; platform admins
  read them too, like every audit entry (PLAN R166: D17b, kept by Dani's decision).
- Reports are anonymized, never deleted, because corrections cite them: at the end of the tenant's retention period
  or on an erasure request, their personal-data columns are set to null.
- A purge moves the tenant's hostnames to `hostname_tombstones`, so they can never be claimed again.
- While purging, the audit and public-cache triggers skip writes only in a session whose role is a member of the table
  owner: a runtime role setting `app.purge` gets neither that nor the immutability exemption, also where it runs with
  the owner's rights (a SECURITY DEFINER function, a foreign key's action; PLAN R165).

### 15. The Host header never authorizes

- The public web app has no session code, no DB credentials and sets no cookies.
- The admin runs on one central host (ADR-0003), with the API under `/api/*` on the same host. Sessions use
  host-only `__Host-` cookies with `Secure; HttpOnly; SameSite=Lax`. The API answers `/api/*` only when the Host is
  the admin host's, so a gateway route added by mistake on a public host still reaches nothing (PLAN R86).
- The tenant being administered comes from the URL path (`/t/{slug}/…`), never from the host. Per-tenant admin
  hosts may be added later for that tenant's members; platform admins only ever use the central host.
- Amended (ADR-0005, PLAN R174): the admin host also serves a site's public pages before it opens, at
  `/t/{slug}/preview/…`, a second way it shows a tenant's content: to whoever the API lets open the tenant (its
  members, any role, and platform admins), the same rule as every admin page; anyone else gets 404. The admin fetches
  them from the web app inside the cluster, on its preview host with a shared secret only the two apps hold, and
  serves them under a policy that runs no script and submits no form (`sandbox allow-same-origin`, no
  `allow-scripts`), so no page of the public site ever acts with a member's session. The web app's preview mode needs
  that secret, so the Host header still grants nothing, and the public app still has no session or cookie.

## Capabilities by role

"Own" means the member's own tenant. The admin shows each user only what is theirs: a member of tenant A gets nothing
of tenant B, not even its published content, which they read on the public site like anyone else. Platform admins see
every tenant, except `reports`.

| Capability                                                                                                                                                                | editor | reviewer | country_admin | platform_admin                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------------- | ----------------------------------- |
| Read own-tenant private data (drafts, sources, queue)                                                                                                                     | ✓      | ✓        | ✓             | ✓ all tenants, **except** `reports` |
| Create and edit drafts, evidence and sources; propose live changes                                                                                                        | ✓      | –        | ✓             | ✓                                   |
| Approve and publish revisions (not own work while the election requires a second reviewer) and change requests (own allowed unless the tenant requires a second approver) | –      | ✓        | ✓             | ✓                                   |
| Triage right-of-reply reports                                                                                                                                             | ✓      | ✓        | ✓             | –                                   |
| Invite members and manage memberships in own tenant                                                                                                                       | –      | –        | ✓             | ✓                                   |
| Tenant theme, election status, announcement and freeze window, methodology **body**, policy texts, report retention, LLM cap                                              | –      | –        | ✓             | ✓                                   |
| Operator, organizations, methodology **kind**, `is_pauseai_chapter`, restricted-asset grants, hostnames, tenant `active`, review settings                                 | –      | –        | –             | ✓ (audited)                         |
| Read the audit log                                                                                                                                                        | –      | –        | ✓             | ✓                                   |

**About platform admins and reports:** the app never lets a platform admin read reports. A platform admin could
grant themselves a membership to do so, but that grant is audited and visible to the tenant's country admin.

## Public-visibility rule

A row is world-readable only when all of these hold:

- It is in a public-capable table.
- Its election's `status` is `live` or `archived`.
- Its tenant is active.

**Announced elections** (amended for the coming-soon page, PLAN R51). A country admin may announce a draft election,
so the tenant's coming-soon page can give its name and date. The public then sees that election's own row (name,
date, type, territory, slug) and nothing under it: its methodology, parties, criteria, cells and sources still follow
the rule above, because each of their policies checks the election's status itself, never the election's visibility.
Nobody creates an election already announced, an announced election keeps its name in the default locale, and the
announcement is fixed once the election goes live.

**Elections in preview** (amended, PLAN R181) follow the rule above for the public: only an announced one's own row
is public, as an announced draft's. The preview's role (§7) also reads their content, as the public will once they
are live; a public history of a cell starts from the version published last before the election went live.

Public-visibility policies apply to `aiontheballot_web` only (and their copies to `aiontheballot_preview`).
`aiontheballot_admin` sees only what memberships give it, so the column grants that hide settings and private columns
from the public can't leak them to members of other tenants.

These platform-wide rows are also public: active `tenants`, verified `tenant_hostnames`, `organizations` and
`core_criteria`.

**Images.** A tenant's uploaded image (a `files` row in the `public_assets` bucket, PNG, JPEG or WebP, and its bytes)
is public while a public row shows it: a party of a live or archived election (its logo), or an active tenant's
brand selection (its logos; amended for tenants' own logos, PLAN R59). Every other upload, and every source
document, stays private.

## Data rules (BRIEF §4), enforced by triggers

### Evidence requirement

- A published rating other than `not_mentioned` needs at least one evidence row with a non-empty verbatim quote.
- `not_mentioned` needs at least one checked-document row for one of the party's own documents, of a kind the
  methodology lists for it, with a stored copy: the proof of an absence is what was checked, kept, and when. It may
  be published before the party's programme exists; when the programme appears, the cell is flagged for a recheck.

**Verbatim match, for every quote** (not only LLM-proposed ones)

- Every quote must appear in its source document's stored extracted text, after both are passed through
  `private.normalize_for_match()`.
- That normalization only affects matching; the quote is always displayed exactly as stored. It:
  - applies Unicode NFKC, which expands ligatures such as "ﬁ";
  - removes soft hyphens and byte-order marks (U+FEFF);
  - re-joins words hyphenated across line breaks;
  - folds typographic quotes and dashes;
  - collapses whitespace.
- Letters and spaces are Unicode's Alphabetic and White_Space on both sides: the database's regexes run under the
  builtin `pg_c_utf8` collation, never the OS's C library, which an image update could change silently (PLAN R113).
- A TypeScript port of the function is tested against the same fixture file, so the UI and the database agree.
- Matching runs across a document's pages, so a quote spanning a page break matches; the public sees the matched
  pages, never a page someone typed.
- **Exception:** sources with no extractable text (scans, video) can use `match_status='attested'`. That requires a
  stored screenshot or clip, and, unless the election doesn't require a second reviewer, an attester who is neither
  the quote's author nor one of the cell's contributors as four-eyes counts them, and who doesn't rewrite the quote
  while attesting it. An attestation that stops meeting this lapses (PLAN R167).

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
- **Per election, on by default** (`elections.require_second_reviewer`): the publisher must not be among the
  revision's **contributors**: anyone who changed its content since the last publish, or uploaded a file it cites.
  Submitting, rejecting and attesting are not contributions. Only the cell's trail records a contributor, for the
  edit it makes, and only a fetch job stores a copy as fetched: anyone else's copy is an upload (PLAN R165).
- **Only a platform admin can turn it off,** and that is audited. Then an author may publish their own work, and the
  revision is marked self-reviewed in a private record, never shown publicly.
- **This deviates from BRIEF §4** ("reviewer ≠ author to publish"), at the owner's decision: the pilot may run with
  one or two people, and a mandatory second person would block publishing whenever one is away. The cost is T14:
  while the setting is off, one compromised account can publish. It applies equally to withdrawals, public notes,
  attestations and corrections after archive.

### History and corrections

- Every publish after the first carries `change_kind` (`update`, `correction` or `withdrawal`) and a public,
  localized note, both written in the draft and reviewed with it. `initial` is only ever the first revision.
- Each such publish appends to the election's corrections log.
- A cell's "last updated" date is the time of its latest revision.

### "Pending" is not "not mentioned"

- A cell with no published revision shows a non-rating _pending_ state; a withdrawn cell shows _withdrawn_.
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
  - This covers the platform's catalogue only. A tenant's own uploads (PLAN R59) can be any image, a copy of a
    protected logo included: they are the tenant's responsibility, as all its content is, and the platform's
    moderation is a takedown, not a check. PauseAI España uploads its own chapter logo this way.

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

1. Normalize the host: lowercase, strip the port and any trailing dot, convert IDNs. A host with userinfo,
   percent-encoding or a path is **404**.
2. If the host is a platform host and the path is `/{slug}/…`:
   - unknown slug → **404**;
   - the tenant has a canonical custom host → **301** to it, same path and query;
   - otherwise → serve.
3. A verified alias hostname → **301** to `canonicalBase`, same path and query.
4. The tenant's canonical hostname → serve.
5. Anything else, including unverified hostnames → a generic **404**. There is never a fallback to a default
   tenant.

**When serving:**

- Requests are rewritten to an internal path that includes the tenant and the locale (`/_tenant/{slug}/{locale}/…`),
  so render caches can never mix tenants.
- Paths whose first segment starts with `_` are reserved and get 404, percent-encoded or not, so no request can
  target the internal prefix. Slugs can never start with `_`.
- System paths are served as they are on any host, without the rewrite: build assets (`/_next/`), the health probe
  (`/healthz`, which the kubelet calls with the pod IP as host) and the relays (`/_relay/`: errors, analytics).
- `www.` gets no special treatment: it is an ordinary alias, and 404 unless registered.
- `resolve()`, `canonicalBase()` and the routing table live in `packages/domain`. The table is built from public
  hostname data and re-checks the hostname invariants above.
- The exact mechanics depend on the framework (ADR-0003). In the web app, `proxy.ts` runs `resolve()` on every request
  but build assets, with a routing table built from `GET /public/routing` on the API, which reads it as
  `aiontheballot_web` (active tenants, with their public settings since PLAN R135, and their verified hostnames). The
  table is refreshed every 30 seconds and the last good one kept; with none, the proxy answers 503, except for system
  paths, so the health probe keeps working.

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

| #   | Threat                                                                           | Actor   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                  | Proven by                                           |
| --- | -------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| T1  | Read B's drafts, sources, reports or audit log                                   | A2–A4   | Membership-based RLS; `aiontheballot_web` has no grants on private tables                                                                                                                                                                                                                                                                                                                                                   | Matrix                                              |
| T2  | Write into B by forging `tenant_id`                                              | A3–A4   | `WITH CHECK` on membership                                                                                                                                                                                                                                                                                                                                                                                                  | Matrix                                              |
| T3  | Reference across tenants (A's evidence or source on B's cell)                    | A3      | Composite FKs                                                                                                                                                                                                                                                                                                                                                                                                               | DB-rule tests                                       |
| T4  | Move a row from one tenant to another                                            | A3–A4   | Immutability trigger plus composite FK                                                                                                                                                                                                                                                                                                                                                                                      | DB-rule tests                                       |
| T5  | Escalate privileges (gain a role in A, or platform admin)                        | A4      | Policies on memberships and invitations; `platform_admins` has no app write path                                                                                                                                                                                                                                                                                                                                            | Matrix                                              |
| T6  | Claim A's hostname, or a domain the attacker doesn't own                         | A4, A7  | Hostname primary key; TXT verification; platform-admin-only writes; gitops PR only after verification                                                                                                                                                                                                                                                                                                                       | Routing and DB tests                                |
| T7  | Spoof the Host header to mix branding or poison a cache                          | A1      | Host only selects content; tenant is in the internal path; internal prefix blocked; absolute URLs built from the DB                                                                                                                                                                                                                                                                                                         | Routing integration tests                           |
| T8  | Sessions or authorization appearing on public hosts                              | A1      | Public app has no session code; one admin host                                                                                                                                                                                                                                                                                                                                                                              | E2E: no `Set-Cookie` on public hosts                |
| T9  | Read or overwrite another tenant's files                                         | A3      | RLS on `app.files`; bytes read only for a visible row, from its own tenant and bucket (ADR-0004)                                                                                                                                                                                                                                                                                                                            | Matrix and API database tests                       |
| T10 | A `SECURITY DEFINER` function or function grant leaks access                     | —       | Allowlist; `search_path=''`; `EXECUTE` revoked from `PUBLIC`                                                                                                                                                                                                                                                                                                                                                                | Catalog meta-tests                                  |
| T11 | A runtime role drifts into ownership or `BYPASSRLS`                              | —       | Role-attribute meta-test                                                                                                                                                                                                                                                                                                                                                                                                    | Catalog meta-tests                                  |
| T12 | The database is exposed outside the cluster                                      | A1      | ClusterIP only; no NodePort                                                                                                                                                                                                                                                                                                                                                                                                 | Deploy check                                        |
| T13 | Secrets leak                                                                     | A9      | SealedSecrets; CI holds no cluster credentials (GitOps pull); no `pull_request_target`                                                                                                                                                                                                                                                                                                                                      | CI review                                           |
| T14 | One compromised editor publishes a false rating                                  | A5      | Four-eyes (residual risk accepted while a platform admin has turned it off for an election); MFA (aal2); audit log; public corrections                                                                                                                                                                                                                                                                                      | DB-rule tests                                       |
| T15 | One person uses a second ("sock-puppet") account to pass four-eyes               | A5      | Invite-only accounts vetted by the country admin; audit trail. **Residual risk accepted**                                                                                                                                                                                                                                                                                                                                   | Process                                             |
| T16 | Platform admin abuses access                                                     | A6      | Few admins, all with MFA; changes audited; no reading `reports` in the app (their audit entries show kind, cell and status, never contents)                                                                                                                                                                                                                                                                                 | Matrix and invariant tests                          |
| T17 | An ineligible tenant uses a restricted brand asset                               | A4      | DB check on catalogue assets; uploads are the tenant's responsibility (R59)                                                                                                                                                                                                                                                                                                                                                 | Invariant tests                                     |
| T18 | Stored XSS through quotes, party names or methodology                            | A3, A8  | Render as text only; sanitized Markdown; CSP                                                                                                                                                                                                                                                                                                                                                                                | Unit and E2E tests                                  |
| T19 | Prompt injection in a programme sways the LLM's suggestions                      | A8      | LLM only suggests; unmatched quotes dropped; humans decide with four-eyes; LLM has no tools                                                                                                                                                                                                                                                                                                                                 | M4 tests                                            |
| T20 | Report spam or denial of service                                                 | A1      | A single function as the only write path; per-tenant cap; honeypot; Envoy per-IP rate limit                                                                                                                                                                                                                                                                                                                                 | Integration tests                                   |
| T21 | A retired or alias domain expires and someone else buys it                       | A7      | Association-owned registrar with auto-renew; hostnames never deleted or detached; uptime monitor per hostname                                                                                                                                                                                                                                                                                                               | Ops checklist                                       |
| T22 | Per-tenant export or purge touches another tenant                                | —       | Owner-only `purge_tenant`; tenant-scoped export                                                                                                                                                                                                                                                                                                                                                                             | Integration tests                                   |
| T23 | Compromised API impersonates users                                               | A10     | Accepted. Small admin surface; immutable audit log; MFA; alert on unusual publish volume                                                                                                                                                                                                                                                                                                                                    | Audit review                                        |
| T24 | A live criterion is reworded, changing what already-published ratings mean       | A5      | Change requests always create a public corrections entry; a second approver if the tenant requires it                                                                                                                                                                                                                                                                                                                       | DB-rule tests                                       |
| T27 | Signup list used to mail-bomb an address, or to learn who is on a list           | A1      | Double opt-in; per mailbox (+tag variants as one) 5 emails at most, 10 minutes apart; a per-tenant daily cap checked first for everyone; the email sent after the answer; per-visitor limit in the API (IPv6 by /64); the gateway's per-IP limit (M3)                                                                                                                                                                       | DB, route and e2e tests                             |
| T28 | Password recovery used to take an account, or to learn who has one               | A1      | Same answer for every address, mail sent after it; links only to enrolled accounts, one per 15 minutes; single-use, hashed, in the fragment; a reset keeps the second factor, ends every session, tells the account (PLAN R170); an account with no second factor gets a link only from the owner's command, after its roles are read and its person confirmed by a known channel, handed to them directly (D19, PLAN R186) | API database, route, command and e2e tests          |
| T29 | A source's URL, or a site's redirect, used to reach inside the cluster (SSRF)    | A5, A8  | Only the fetcher fetches, with no login or volume; public addresses only, by NetworkPolicy and in its own lookup; ports 80 and 443; each redirect checked; deadline and size cap (ADR-0007)                                                                                                                                                                                                                                 | Fetcher unit and API route tests                    |
| T30 | The admin's preview, or its secret, used to read an election before it is public | A1, A10 | Its own role, which reads elections in preview and what the public reads, never a draft's content or private data; routes only for the shared secret, compared in constant time, sent only by the web app's preview host, itself reachable only in the cluster with the same secret (ADR-0005)                                                                                                                              | RLS matrix, catalog meta-tests, route and e2e tests |

## Test matrix (BRIEF §8)

The matrix proves tenant isolation at the database level.

### Harness

The harness uses Vitest (via `@slango.configs/vitest`) and `pg`, against Postgres 18. ADR-0003 decides whether
that Postgres is a service container or embedded binaries.

Each case runs in its own transaction, which is rolled back afterwards:

1. Switch role: `SET LOCAL ROLE aiontheballot_web` or `aiontheballot_admin`.
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
- An announced draft in `test-a` and in the inactive tenant; `test-b`'s draft is not announced.
- Unverified and retired hostnames.

### Dimensions

Expected outcomes are written as data in `packages/db/tests/rls/matrix.ts`, and the individual test cases are generated
from it.

- **Principals:**
  - `aiontheballot_web` (the API's public routes);
  - `aiontheballot_preview` (the API's preview routes, PLAN R181);
  - `aiontheballot_admin` with no actor set;
  - a user with no membership;
  - editor@A, reviewer@A, country_admin@A and platform_admin, **each at aal2 and at aal1**;
  - a user who is editor in A and reviewer in B;
  - a member whose membership was just revoked.
- **Target tenant:** own, other, or platform-wide.
- **Row state:** published in a live election, archived, in preview, draft, `in_review`, or belonging to an inactive
  tenant.
- **Operations:**
  - select, insert, update and delete;
  - plus **column-level updates** of sensitive columns: `assessments.state`, actor columns, `tenant_id`,
    `tenants.active`, `tenants.methodology_kind`, `methodologies.kind`, `elections.require_second_reviewer` and
    `tenants.live_edits_need_second_approver`.
- **Relations:** every table and view in `app.*`, plus **every function a runtime role can execute**. The
  authoritative list is [the data model spec](../spec/data-model.md) (and, once they exist, the migrations). The
  catalog meta-test fails if `matrix.ts` and the database disagree.

### Expected outcomes by table class

Exceptions are listed in `matrix.ts`.

| Principal                                                          | Public-capable, own, published      | Public-capable, own, draft or in_review  | Private, own                                                | Any row of another tenant            | Immutable tables                 |
| ------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------ | -------------------------------- |
| `aiontheballot_web`                                                | Read only                           | Deny                                     | Deny                                                        | Published: read only. Otherwise deny | Read published only; never write |
| `aiontheballot_admin` with no actor, no membership, or **at aal1** | Deny                                | Deny                                     | Deny                                                        | Deny                                 | Deny                             |
| editor@A, aal2                                                     | Read; cannot change status directly | Read, insert and update; delete drafts   | Read; write sources; triage reports                         | Deny                                 | Read; never update or delete     |
| reviewer@A, aal2                                                   | Read                                | Read; approve or reject (never own work) | Read; triage reports                                        | Deny                                 | Read; never update or delete     |
| country_admin@A, aal2                                              | Read                                | Full access to drafts                    | Full, including invitations and memberships; read audit log | Deny                                 | Read; never update or delete     |
| platform_admin, aal2                                               | All tenants                         | All tenants                              | All, **except `reports`**                                   | All tenants                          | Read; never update or delete     |

### Catalog meta-tests

These fail when someone adds a database object without wiring it in:

1. Every `app.*` table has RLS enabled.
2. Every `app.*` table and every executable function appears in `matrix.ts`, and nothing listed there is stale.
3. Every table with a `tenant_id` has the immutability trigger and composite FKs, and each of its other uuid
   columns is in an enforced foreign key that pins `tenant_id` (or one to a listed shared table), unless listed with a
   reason: account ids, and targets a trigger checks (PLAN R168).
4. The runtime roles own nothing and have neither `BYPASSRLS`, `CREATEROLE` nor superuser.
5. `aiontheballot_web` and `aiontheballot_preview` have no `INSERT`, `UPDATE` or `DELETE` grant anywhere, nor
   `USAGE` on any schema but `app`; the preview's role reads exactly the public role's columns, with a read policy
   wherever the public role has one (PLAN R181).
6. `EXECUTE` grants match the allowlist, and no function is executable by `PUBLIC`.
7. Every `SECURITY DEFINER` function is on the allowlist and sets `search_path`.
8. Every view is `security_invoker`, and there are no materialized views.
9. Every immutable table has its `UPDATE`, `DELETE` and `TRUNCATE` triggers.

### Data-rule and invariant tests

Each of these must fail:

- Publishing without evidence, including through a direct `INSERT` that skips the server function.
- Publishing `not_mentioned` without a checked record of one of the party's own stored documents.
- Self-review while the election requires a second reviewer, including by someone who only co-edited the revision
  or uploaded a file it cites.
- Publishing content other than the reviewed draft: a stale version, or writing the revision tables directly.
- Editing a cell while it is in review.
- `change_kind = 'initial'` on a later revision.
- Turning off the second-reviewer setting as anyone but a platform admin.
- Review by a reviewer from another tenant.
- Review by a reviewer at aal1.
- Publishing a quote that doesn't match its source text.
- `UPDATE`, `DELETE` or `TRUNCATE` on an immutable table.
- Running `purge_tenant` as any role other than the owner.
- Editing a criterion in a live election without an approved change request, including after setting any session
  variable.
- Approving one's own change request when the tenant requires a second approver.
- A change request whose target belongs to another tenant or another election.
- Writing an actor column (`created_by`, `decided_by`, `attested_by`, …) as someone other than the current user.
- Updating or deleting a decided change request, or supplying its "before" value.
- Citing another party's source on a cell.
- Inserting `source_texts` without an open extraction job; the worker writing outside its job request.
- Updating a stored file, or deleting a referenced one.
- Publishing in a draft election, anything but a correction or withdrawal in an archived one, or anything public
  inside a freeze window.
- Claiming a tombstoned hostname.
- Updating or deleting `assessment_contributors` rows, or inserting one directly (only the cell's trail does, for its
  writer and the current revision).
- Storing a source's copy as fetched outside the worker's fetch job.
- Setting `match_status` to `matched` by hand, or updating `source_texts` or a cited source's file.
- Referencing a party, criterion or source from another election of the same tenant.
- A territory code, on an election or a party, outside the tenant's country; changing a live election's territory.
- A worker job whose payload names a different tenant from its `job_requests` row.
- An audit diff containing a column marked as personal data.
- A country admin changing the operator or the methodology kind.
- Anyone other than a platform admin setting `is_pauseai_chapter`.
- An ineligible tenant selecting a restricted brand asset.
- A duplicate hostname.
- A second canonical hostname for the same tenant.
- An unverified canonical hostname.
- Deleting a hostname.

These must fail too, but are no longer database rules since the bytes left Postgres
([ADR-0004](0004-file-bytes-on-a-volume.md)): the file store's unit tests and the API's database tests prove them.

- Storing or serving bytes whose hash doesn't match the one their row records.
- Serving bytes from a space other than their row's: another tenant's, another bucket's, or the platform's.

And each of these must succeed:

- Quotes whose PDF text contains ligatures or line-break hyphenation.
- `purge_tenant` run as the owner role.
- Approving one's own change request when the tenant does not require a second approver.
- A reviewer who rejected a cell approving it after the fix.
- Self-review when a platform admin has turned off the election's second-reviewer setting, recorded as such.
- A correction in an archived election.
- A quote spanning a page break.
- Anonymizing a report that a correction cites.
- A caller-supplied timestamp, replaced by the transaction time.
- Every permitted operator or kind change, which also writes an audit row.

### Routing tests

**Unit tests**, table-driven, against `resolve()`:

- Unknown host → 404.
- Unverified host → 404.
- Alias → 301 with the same path and query.
- Platform `/{slug}` → 301 when the tenant has a custom canonical host.
- Edge cases: ports, mixed case, a trailing dot, IDNs, and `www.`

**Integration tests** in the CI end-to-end stack, which has the fictional seeds (there is no staging, ADR-0001).
The cases that need no tenant data also run against production:

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
