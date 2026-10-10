# Spec: data model

- **Status:** Approved. Revised after two adversarial reviews (brief coverage; integrity and security), with the
  product decisions recorded in PLAN.md (Answered).
- **Relates to:** [ADR-0002](../adr/0002-tenancy-and-authorization.md) (rules and isolation),
  [ADR-0003](../adr/0003-application-stack.md) (dbmate, Kysely), BRIEF §2–§5

This spec is the source of truth for the M1 migrations. Once they exist, the migrations and `db/schema.sql` become
authoritative, and this document is kept in sync. ADR-0002 says _what_ must hold; this spec says _where_ each rule
lives. Any example data here is fictional.

## 1. Conventions

**Schemas:**

| Schema    | Holds                | Notes                                                |
| --------- | -------------------- | ---------------------------------------------------- |
| `app`     | All tables           |                                                      |
| `private` | Helper functions     | Not granted broadly                                  |
| `auth`    | Better Auth's tables | See [open item 2](#9-open-items)                     |
| `pgboss`  | The job queue        | Created by the migration Job (owner), not at runtime |

**Columns and constraints:**

- **Keys:** `id uuid primary key default uuidv7()`. Postgres 18 has `uuidv7()` built in; time-ordered keys keep
  indexes compact.
- **Tenant ownership:**
  - Tenant-owned tables have `tenant_id uuid not null` and `unique (tenant_id, id)`.
  - Children reference parents through composite foreign keys, `(tenant_id, parent_id) → parent (tenant_id, id)`.
  - `tenant_id` never changes (trigger).
- **Same election:** a row that belongs to an election references its parties, criteria, sources and cells
  through `(tenant_id, election_id, …)` foreign keys, so nothing can mix two elections, even within one tenant.
  Parents expose `unique (tenant_id, election_id, id)` for this.
- **Actor columns** are set by trigger to `private.current_user_id()`; a value sent by the caller is overwritten, so
  nobody can act in someone else's name. Each is set at one moment only (columns set on insert or on every update by
  `private.stamp(columns…)`, the others by the trigger for their transition):

  | Columns                                                                             | Set                                    |
  | ----------------------------------------------------------------------------------- | -------------------------------------- |
  | `created_by`, `proposed_by`, `requested_by`, `granted_by`, `checked_by`, `actor_id` | On insert                              |
  | `updated_by`                                                                        | On every insert and update             |
  | `decided_by`, `triaged_by`, `attested_by`                                           | On the transition that sets them, once |
  | `reviewer_id` (`revision_internal`)                                                 | By the publish trigger                 |

- **Event timestamps** (`created_at`, `published_at`, `proposed_at`, `decided_at`, `triaged_at`, `checked_at`,
  `granted_at`, `approved_at`, `went_live_at`, `programme_checked_at`, `anonymized_at`, `first_edit_at`) are set by
  trigger to the transaction time, alongside their actor column. A caller can't backdate anything, so "last updated"
  and the order of the corrections log are true.
- **Personal data columns** carry the column comment `personal data`. The audit trigger never copies them into
  `audit_log`, and a catalog test checks every such column. They are: report contents (`name`, `email`,
  `organization`, `message`, `resolution_note`), `invitations.email`, `files.original_filename`,
  `methodology_reviewers.name`, and the values of change requests and structural changes (`proposed_value`,
  `previous_value`, `new_value`), which can hold a reviewer's name. Binary (`bytea`) columns are never logged
  either; their tables log the content's SHA-256.
- **Localized text:** `jsonb` objects that map a locale to a string, e.g. `{"es": "…", "en": "…"}`.
  - The domain `app.localized` checks the shape: a non-empty object whose keys are locale codes (`app.locale`) and
    whose values are non-blank strings.
  - The tenant's default locale must be present before anything goes public: at publish time, when an election goes
    live, and when a change request is approved.
- **Slugs:** the domain `app.slug`, lowercase, matching `^[a-z0-9]+(-[a-z0-9]+)*$`. Election, party and criterion
  slugs are fixed once the election leaves `draft`, because share images carry their URLs. An election slug is never
  locale-shaped (`^[a-z]{2}(-[a-z]{2})?$`), since `/ca/…` is a locale prefix, and never one of the paths the public
  site serves itself (`brand`, `healthz`, `og`: `RESERVED_ELECTION_SLUGS` in `packages/domain`).
- **Domains** (`app.localized`, `app.slug`, `app.locale`) check with built-in functions only, so writing them needs
  no `EXECUTE` grant to a runtime role. The illustrative SQL below writes their base types, `jsonb` and `text`.
- **Emails:** stored lowercased (`check (email = lower(email))`).
- **Timestamps:** `created_at timestamptz not null default now()`. Mutable tables also get `updated_at`, kept by a
  trigger.
- **Deletes:**
  - Published data is never deleted. Parties, criteria and methodology reviewers of a live election are retired,
    not deleted.
  - Drafts can be deleted, including a cell that was never published (with its drafts and contributor rows).
  - Reports are anonymized, never deleted, because corrections cite them.
  - A whole tenant can be removed only through `private.purge_tenant()` (ADR-0002 §14).

The SQL below is **illustrative**: it shows columns, types and constraints, but leaves out the grants, policies and
triggers, which the [enforcement map](#6-enforcement-map) covers.

## 2. Enumerations

| Type                   | Values                                                                                 | Notes                                                              |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `tenant_role`          | `country_admin`, `editor`, `reviewer`                                                  | `platform_admin` is a separate table                               |
| `org_role`             | `operator`, `endorser`                                                                 |                                                                    |
| `election_type`        | `general`, `european`, `regional`, `municipal`, `other`                                |                                                                    |
| `election_status`      | `draft`, `live`, `archived`                                                            |                                                                    |
| `methodology_kind`     | `demands`, `descriptive`                                                               |                                                                    |
| `rating`               | `meets`, `partially_meets`, `does_not_meet`, `green`, `yellow`, `red`, `not_mentioned` | Which values are valid depends on the methodology kind (see below) |
| `assessment_state`     | `draft`, `in_review`, `published`                                                      | The working state of a cell                                        |
| `change_kind`          | `initial`, `update`, `correction`, `withdrawal`                                        | `initial` only for a cell's first revision                         |
| `source_kind`          | `pdf`, `web_page`, `social_post`, `video`, `audio`, `party_submission`                 |                                                                    |
| `match_status`         | `unmatched`, `matched`, `attested`                                                     |                                                                    |
| `extraction_status`    | `pending`, `done`, `failed`, `not_applicable`                                          | One way: `pending` to one of the others                            |
| `programme_status`     | `pending`, `published`                                                                 |                                                                    |
| `file_bucket`          | `public_assets`, `sources`                                                             | Platform brand assets live in `brand_assets`                       |
| `review_event_kind`    | `submitted`, `recalled`, `approved`, `rejected`, `commented`                           |                                                                    |
| `change_action`        | `update`, `add`, `retire`                                                              |                                                                    |
| `change_request_state` | `pending`, `approved`, `rejected`                                                      |                                                                    |
| `report_kind`          | `error_report`, `party_response`                                                       |                                                                    |
| `report_status`        | `new`, `triaged`, `accepted`, `rejected`, `spam`                                       |                                                                    |
| `suggestion_state`     | `open`, `accepted`, `rejected`                                                         |                                                                    |
| `evidence_origin`      | `manual`, `llm`, `mcp`                                                                 | Provenance of a quote (M4, and the later MCP server)               |
| `job_kind`             | `fetch_source`, `extract_source`, `archive_source`, `llm_run`                          | See [§8](#8-jobs-pg-boss)                                          |
| `tenant_document_kind` | `privacy_policy`, `right_of_reply_policy`, `about_operator`                            | The legal notice is generated, not stored                          |

**Valid ratings per methodology kind:**

- **`demands`:** `meets`, `partially_meets`, `does_not_meet`, `not_mentioned`.
- **`descriptive`:** `green`, `yellow`, `red`, `not_mentioned`.
  - The difference between `red` ("no position") and `not_mentioned` is still undefined (PLAN P6). It doesn't block
    Spain, which uses `demands`.

**How ratings are displayed:** labels, icons and colours live in `packages/domain` and `packages/i18n`, never in
the database. That's the fixed rating language, which tenants can't change. The Spanish labels come from the brief,
for example "Cumple", "Cumple parcialmente", "No cumple" and "No lo menciona".

## 3. Tables

### 3.1 Platform

```sql
create table app.tenants (
  id                 uuid primary key default uuidv7(),
  slug               text not null unique,                -- 'es', 'test-a'
  country_code       text not null check (country_code ~ '^[A-Z]{2}$'),  -- ISO 3166-1; seeds use XA–XZ
  default_locale     text not null,                       -- 'es'
  enabled_locales    text[] not null,                     -- public locales
  display_name       jsonb not null,                      -- localized
  theme              jsonb not null default '{}',         -- colours only, contrast-checked; logos: brand selections
  methodology_kind   app.methodology_kind not null,       -- BRIEF §3 invariant 6: platform_admin only
  active             boolean not null default false,
  live_edits_need_second_approver  boolean not null default false,  -- platform_admin only (ADR-0002 §12)
  report_retention_days  int not null check (report_retention_days > 0),  -- the value is the operator's (PLAN Q7)
  llm_monthly_cap_usd    numeric(10, 2) not null default 0,               -- 0 means LLM assistance is off
  created_at         timestamptz not null default now(),
  check (default_locale = any (enabled_locales))
);

create table app.platform_hostnames (hostname text primary key);   -- reserved exact names: admin host, platform domain

create table app.tenant_hostnames (
  hostname      text primary key,                        -- lowercase ASCII/punycode, no port, no trailing dot
  tenant_id     uuid not null references app.tenants,
  is_canonical  boolean not null default false,
  verified_at   timestamptz,
  retired_at    timestamptz,                             -- still served: retired hostnames 301 forever
  created_at    timestamptz not null default now(),
  check (not is_canonical or verified_at is not null),
  check (not (is_canonical and retired_at is not null))
);
create unique index on app.tenant_hostnames (tenant_id) where is_canonical;

-- Hostnames of purged tenants. They are printed on circulating share images, so they can never be claimed again;
-- routing answers them with 410 Gone.
create table app.hostname_tombstones (
  hostname   text primary key,
  purged_at  timestamptz not null default now()
);

create table app.hostname_verifications (              -- private
  hostname         text primary key references app.tenant_hostnames,
  token_hash       text not null,
  last_checked_at  timestamptz,
  last_result      text
);

create table app.brand_assets (                        -- platform-global; bytes on the file volume (platform)
  id            uuid primary key default uuidv7(),
  name          text not null,
  restricted    boolean not null default false,        -- e.g. a PauseAI mark
  content_type  text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),  -- no SVG (script)
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size     bigint not null check (byte_size between 1 and 2097152),  -- 2 MB
  created_at    timestamptz not null default now()
);

create table app.organizations (                       -- platform-global; public (legal notice); platform_admin writes
  id                  uuid primary key default uuidv7(),
  display_name        jsonb not null,
  legal_name          text not null,
  tax_id              text,
  address             text,
  registry_entry      text,                            -- pending counsel (PLAN Q6)
  contact_email       text,
  privacy_email       text,                            -- the privacy contact (PLAN Q7)
  url                 text,
  logo_asset_id       uuid references app.brand_assets,  -- a restricted asset only if is_pauseai_chapter
  is_pauseai_chapter  boolean not null default false,
  created_at          timestamptz not null default now()
);

create table app.tenant_organizations (
  tenant_id        uuid not null references app.tenants,
  organization_id  uuid not null references app.organizations,
  role             app.org_role not null,
  display_order    int not null default 0,
  primary key (tenant_id, organization_id)
);
create unique index on app.tenant_organizations (tenant_id) where role = 'operator';

create table app.brand_asset_grants (
  brand_asset_id  uuid references app.brand_assets,
  tenant_id       uuid references app.tenants,
  granted_by      uuid not null,
  granted_at      timestamptz not null default now(),
  primary key (brand_asset_id, tenant_id)
);

-- The only source of tenant logos on public pages and share images.
create table app.tenant_brand_selections (
  tenant_id       uuid references app.tenants,
  slot            text not null,                       -- e.g. 'operator_logo_on_accent', 'operator_mark'
  brand_asset_id  uuid references app.brand_assets,    -- a platform asset, or
  file_id         uuid,                                -- the tenant's own upload (public_assets), PLAN R59
  primary key (tenant_id, slot),
  foreign key (tenant_id, file_id) references app.files (tenant_id, id),
  check (num_nonnulls(brand_asset_id, file_id) = 1)
);

-- Versioned policy texts the operator writes. Published versions are immutable; the public sees the latest one.
create table app.tenant_documents (
  id            uuid primary key default uuidv7(),
  tenant_id     uuid not null references app.tenants,
  kind          app.tenant_document_kind not null,
  version       int not null,                          -- next number per tenant and kind, set by trigger
  body          jsonb not null,                        -- localized Markdown, sanitized on render
  published_at  timestamptz,                           -- null while a draft
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, kind, version)
);

-- The public cache key (ADR-0003): bumped by trigger on every public-visible write of the tenant's data, including
-- shared rows its pages show (its organizations, selected brand assets).
create table app.public_versions (
  tenant_id  uuid primary key references app.tenants,
  version    bigint not null default 0
);

create table app.core_criteria (                       -- global, for future cross-country views
  id           uuid primary key default uuidv7(),
  key          text not null unique,
  title        jsonb not null,
  description  jsonb not null
);

create table app.platform_admins (
  user_id     uuid primary key,                        -- references the Better Auth user
  created_at  timestamptz not null default now()
);
```

**Hostnames.** Every hostname column is the domain `app.hostname`: what `resolve()` normalizes a host to (lowercase
ASCII, punycode, no port or trailing dot), with at least two labels and a last label starting with a letter.
`verified_at` and `retired_at` are each set once, at the transaction time; a hostname is never renamed, moved, deleted
or claimed already retired; reserved and tombstoned names can't be claimed, and a reserved name can't be one a tenant
already has. A canonical hostname moves in two statements (unset, then set), because the one-canonical index is
checked row by row.

**The legal notice is generated** (BRIEF §3, invariant 3) from the operator's `organizations` row, with i18n
templates. The privacy policy, the right-of-reply policy (including the corrections turnaround) and the text about
the operator are `tenant_documents` written by the operator.

### 3.2 Membership

```sql
create table app.memberships (
  user_id     uuid not null,
  tenant_id   uuid not null references app.tenants,
  role        app.tenant_role not null,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, tenant_id, role)
);

create table app.invitations (
  id           uuid primary key default uuidv7(),
  tenant_id    uuid not null references app.tenants,
  email        text not null check (email = lower(email)),  -- personal data
  role         app.tenant_role not null,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_by  uuid,
  revoked_at   timestamptz,
  unique (tenant_id, id)
);
```

**Invitations.** The token is random and only its SHA-256 is stored; an invitation expires within 30 days. It changes
once: revoked, or accepted before it expires (the time and the acceptor come from the session). Only country admins
and platform admins see invitations, since they hold emails; they may delete one once it is no longer pending, so an
email is kept only while needed (the audit log keeps the id only). `private.accept_invitation(token)` arrives in M2
with Better Auth's tables, because it checks the invited email against the user's verified email.

### 3.3 Elections, methodology, parties and criteria

```sql
create table app.elections (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null references app.tenants,
  slug               text not null,                    -- 'generales-2026'
  type               app.election_type not null,
  territory_code     text check (territory_code ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'),  -- ISO 3166-2; null = whole country
  name               jsonb not null,
  election_date      date,
  status             app.election_status not null default 'draft',
  announced          boolean not null default false,   -- a draft whose row is public (PLAN R51); country admins
  went_live_at       timestamptz,                      -- set by trigger
  require_second_reviewer  boolean not null default true,  -- four-eyes on cells; only a platform_admin turns it off
  frozen_from        timestamptz,                      -- the freeze window (PLAN Q8): see §4
  frozen_until       timestamptz,                      -- null with frozen_from set: frozen until cleared
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, slug),
  check (slug !~ '^[a-z]{2}(-[a-z]{2})?$'),
  check (type not in ('general', 'european') or territory_code is null),
  check (type <> 'regional' or territory_code is not null),
  check (frozen_until is null or (frozen_from is not null and frozen_until > frozen_from))
);

create table app.methodologies (                       -- one per election
  id                       uuid primary key default uuidv7(),
  tenant_id                uuid not null,
  election_id              uuid not null unique,
  kind                     app.methodology_kind not null,  -- equals tenants.methodology_kind (trigger)
  demands_owner_id         uuid references app.organizations,  -- the tenant's operator or an endorser (trigger)
  body                     jsonb not null,             -- localized Markdown, sanitized on render
  admissible_source_kinds     app.source_kind[] not null default '{pdf,web_page}',  -- may back a rating (PLAN Q9)
  not_mentioned_source_kinds  app.source_kind[] not null default '{pdf,web_page}',  -- may back "not mentioned"
  unique (tenant_id, id),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id),
  check ((kind = 'demands') = (demands_owner_id is not null))
);

create table app.methodology_reviewers (               -- named external reviewers (public)
  id              uuid primary key default uuidv7(),
  tenant_id       uuid not null,
  methodology_id  uuid not null,
  name            text not null,                       -- personal data (published with consent)
  affiliation     text not null,
  display_order   int not null default 0,
  retired_at      timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, methodology_id) references app.methodologies (tenant_id, id)
);

create table app.parties (
  id                    uuid primary key default uuidv7(),
  tenant_id             uuid not null,
  election_id           uuid not null,
  slug                  text not null,                 -- party pages and share images
  name                  jsonb not null,                -- localized; see open item 5
  short_name            jsonb not null,
  logo_file_id          uuid,                          -- an image in the public_assets bucket
  colour                text check (colour ~ '^#[0-9a-f]{6}$'),
  display_order         int not null,
  website               text,
  programme_status      app.programme_status not null default 'pending',
  programme_checked_at  timestamptz,                   -- "comprobado el …"; set by trigger with programme_status
  territory_codes       text[],                        -- ISO 3166-2 codes where it stands; null = everywhere
  retired_at            timestamptz,                   -- left the election (through a change request once live)
  unique (tenant_id, id),
  unique (tenant_id, election_id, id),
  unique (election_id, slug),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id),
  foreign key (tenant_id, logo_file_id) references app.files (tenant_id, id),
  check (territory_codes is null or cardinality(territory_codes) > 0)
);
```

**Who writes the structure** (PLAN, Answered: election structure). Editors and country admins write elections (name,
date, slug, type, territory), parties and criteria; country admins set the status, the announcement and the freeze
window and write the methodology and its external reviewers; only platform admins change `require_second_reviewer`.
Column grants make every new election an unannounced draft with four-eyes on and no freeze;
`private.restrict_columns(roles, columns…)` guards the rest. Structure is deleted only while its election is a draft.
A party's logo must be an image in the `public_assets` bucket, so no source document can become public through it.

**Territories.** A tenant is one country (`country_code`). An election covers either the whole country
(`territory_code` null: generales, europeas, which Spain votes as one constituency) or one subdivision (a regional
election, `ES-AN`). Each regional or municipal election is its own election, with its own parties, criteria and
cells, so several can share a date. A party that stands only in some places lists them in `territory_codes` (for
example one province in a general election), and the public site can say so; most parties leave it null. A trigger
checks that every code, on the election and on its parties, starts with the tenant's country code, and that the
election's `territory_code` can't change once it leaves `draft`. Party territories are structural edits, so in a
live election they need a change request (§3.7). ISO 3166-2 names autonomous communities (`ES-MD`) and provinces
(`ES-M`) but not municipalities, and the codes alone don't say which province lies in which region: see
[open item 7](#9-open-items).

**Programme status.** `programme_status` and `programme_checked_at` are the only party columns editable without a
change request once live; one person may update them (audited), and the public sees the check date. Setting
`published` requires a source of that party marked `is_programme` (§3.4). When it is set, every cell of the party
whose current rating is `not_mentioned` gets a `recheck_reason` (§3.5), so the programme is checked against it.
Every update that sets the status, even to the same value, is a check: it stamps `programme_checked_at`, which nobody
writes otherwise, and is refused inside the freeze window. A new party's programme is pending and unchecked. The
recheck reason is `programme_published`, set only when the status changes to `published`.

```sql
create table app.criteria (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null,
  election_id        uuid not null,
  slug               text not null,                    -- criterion pages and share images
  title              jsonb not null,
  short_title        jsonb,                            -- the public table's column header; needed to go live
  description        jsonb not null,
  display_order      int not null,
  core_criterion_id  uuid references app.core_criteria,
  retired_at         timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, election_id, id),
  unique (election_id, slug),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id)
);
```

### 3.4 Files and sources

```sql
-- Immutable: no UPDATE, and DELETE only while nothing references the file.
create table app.files (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null references app.tenants,
  bucket             app.file_bucket not null,
  content_type       text not null,
  byte_size          bigint not null check (byte_size <= 52428800),   -- 50 MB
  sha256             text not null,
  original_filename  text,                             -- personal data (file names often carry names)
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, bucket, sha256),                  -- the same file is stored once per tenant and bucket
  check (bucket <> 'public_assets' or content_type in ('image/png', 'image/jpeg', 'image/webp'))
);

-- A party's document (or a party-neutral one, party_id null). The stored copy is set once: by the fetch job from
-- the URL (file_origin 'fetched'), or by an upload (file_origin 'uploaded', whose uploader then counts as a
-- contributor of every cell citing it). After that only extraction_status (one way) and archive_url (once) change,
-- so a quote matched against a source stays matched against the same bytes. A wrong source is replaced, not edited.
create table app.source_documents (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null,
  election_id        uuid not null,
  party_id           uuid,
  kind               app.source_kind not null,
  title              text not null,                    -- as published, in its original language
  url                text,
  language           text,
  is_programme       boolean not null default false,   -- the party's electoral programme
  file_id            uuid,                             -- our stored copy (bucket: sources)
  file_origin        text check (file_origin in ('fetched', 'uploaded')),
  sha256             text,                             -- copied from the file by trigger: the public hash (P8)
  retrieved_at       timestamptz,                      -- when the copy was stored, set by trigger
  archive_url        text,                             -- set once, by the archive job
  extraction_status  app.extraction_status not null default 'pending',
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, election_id, id),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id),
  foreign key (tenant_id, election_id, party_id) references app.parties (tenant_id, election_id, id),
  foreign key (tenant_id, file_id) references app.files (tenant_id, id),
  check ((file_id is null) = (file_origin is null) and (file_id is null) = (sha256 is null)),
  check ((file_id is null) = (retrieved_at is null)),
  check (not is_programme or party_id is not null)
);

-- Private: the full text is never public (copyright). Written by the extraction job only, while the source is
-- 'pending' and its extract_source job request is open; never updated or deleted. So nobody can add or edit the
-- text a quote is matched against.
create table app.source_texts (
  source_document_id  uuid not null,
  tenant_id           uuid not null,
  unit_index          int not null,                    -- the page number for PDFs, the section index for web pages
  label               text not null,                   -- 'p. 47', or a section heading
  body                text not null,
  normalized          text generated always as (private.normalize_for_match(body)) stored,
  primary key (source_document_id, unit_index),
  foreign key (tenant_id, source_document_id) references app.source_documents (tenant_id, id)
);
```

**Stored files.** A file's row is here; its bytes are on the file volume under the row's tenant, bucket and SHA-256
(ADR-0004), written before the row by a store that computes the hash: the store's rule, not the database's, keeps a
row from naming missing or different bytes. The API reads bytes only for a row RLS shows, from that row's own tenant
and bucket, and the store checks the hash again on every read. A file is never updated, and is deleted only while
nothing references it; bytes no row names are swept from the volume after a grace period (identical bytes are stored
once per tenant and bucket). A purge deletes the tenant's bytes with `purge-tenant-files`, given proof from
`purge_log` that the tenant is gone.

**Citable sources.** Evidence or a checked-document record may cite a source only once it has a stored copy and
its extraction is `done` (or `not_applicable`, for kinds without text). The source's `party_id` must be null or the
cell's party: one party's documents never back another party's cell. Its kind must be one the methodology admits
(`admissible_source_kinds` for quotes, `not_mentioned_source_kinds` for checked documents). Triggers check all of
this when the row is written (`private.evidence_rules()`, `private.checked_document_rules()`), as the writer.

**Sources over time.** A source starts `pending`; its extracted text is added only while it is pending and has a stored
copy, and `done` needs that copy. Sources can still be added to an archived election, because corrections may cite new
documents.

**Matching across units.** The verbatim check runs on a source's units joined in order with a single space, so a
quote that crosses a page break still matches. The trigger records the first and last unit the match spans; the
public sees those units' labels (for example "pp. 47–48"), never a page the editor typed.

### 3.5 Assessments (cells): the working copy

```sql
create table app.assessments (
  id                   uuid primary key default uuidv7(),
  tenant_id            uuid not null,
  election_id          uuid not null,
  party_id             uuid not null,
  criterion_id         uuid not null,
  state                app.assessment_state not null default 'draft',
  draft_rating         app.rating,                     -- null for a withdrawal
  draft_summary        jsonb,
  draft_change_kind    app.change_kind,                -- null before the first publish (it will be 'initial')
  draft_public_note    jsonb,                          -- required for every change after the first
  generation           int not null default 0,         -- publishes so far; contributions are counted per generation
  content_version      int not null default 0,         -- bumped by every content change, by trigger
  recheck_reason       text,                           -- private flag, e.g. the party's programme appeared
  updated_by           uuid not null,
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, id, election_id),
  unique (tenant_id, id, election_id, party_id, criterion_id),
  unique (party_id, criterion_id),
  foreign key (tenant_id, election_id)               references app.elections (tenant_id, id),
  foreign key (tenant_id, election_id, party_id)     references app.parties (tenant_id, election_id, id),
  foreign key (tenant_id, election_id, criterion_id) references app.criteria (tenant_id, election_id, id)
);
-- What the public sees is the latest revision (app.current_revisions); there is no pointer column to keep in sync.

-- Who changed a cell's content in a generation. Content means the draft columns of the cell (rating, summary,
-- change kind, public note) and any insert, update or delete of its draft_evidence or draft_checked_documents.
-- Submitting, rejecting, recalling and attesting are not contributions, so a reviewer who rejects a cell can still
-- approve it later. Rows are added by those triggers (current_user_id(), current generation), on conflict do
-- nothing. Runtime roles have INSERT but no UPDATE or DELETE, and a trigger rejects any row that isn't the current
-- user at the current generation: adding yourself can only stop you approving.
create table app.assessment_contributors (
  assessment_id  uuid not null,
  tenant_id      uuid not null,
  generation     int not null,
  user_id        uuid not null,
  first_edit_at  timestamptz not null default now(),
  primary key (assessment_id, generation, user_id),
  foreign key (tenant_id, assessment_id) references app.assessments (tenant_id, id)
);

create table app.draft_evidence (
  id                   uuid primary key default uuidv7(),
  tenant_id            uuid not null,
  election_id          uuid not null,
  assessment_id        uuid not null,
  source_document_id   uuid not null,
  ordinal              int not null,
  quote                text not null check (char_length(btrim(quote)) between 15 and 1000),
  unit_index           int,                            -- the page or section the editor points at (a hint only)
  section_label        text,
  ts_start             numeric(10, 3),                 -- video and audio, in seconds
  ts_end               numeric(10, 3),
  match_status         app.match_status not null default 'unmatched',  -- always computed by trigger, see below
  matched_from_unit    int,                            -- set with match_status 'matched'
  matched_to_unit      int,
  attested_by          uuid,                           -- set by trigger to the attesting user
  attestation_file_id  uuid,                           -- a screenshot or clip in the sources bucket
  origin               app.evidence_origin not null default 'manual',
  llm_suggestion_id    uuid,                           -- with origin 'llm'
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, assessment_id, election_id)      references app.assessments (tenant_id, id, election_id),
  foreign key (tenant_id, election_id, source_document_id) references app.source_documents (tenant_id, election_id, id),
  foreign key (tenant_id, attestation_file_id)             references app.files (tenant_id, id),
  foreign key (tenant_id, llm_suggestion_id)               references app.llm_suggestions (tenant_id, id),
  check ((origin = 'llm') = (llm_suggestion_id is not null))
);
-- match_status is never taken from the caller. For sources with extracted text, the trigger computes matched or
-- unmatched against source_texts.normalized. For sources without text (kinds other than pdf and web_page, or a
-- scanned PDF whose extraction is not_applicable) it is 'attested' only when someone attests: a stored attestation
-- file in the sources bucket, attested_by = the current user, and that user is not the quote's author (unless the
-- election doesn't require a second reviewer). Otherwise 'unmatched'. The 15-character minimum stops trivial
-- matches (it applies to the normalized quote too); the 1000-character maximum keeps quotes proportionate
-- (copyright).

create table app.draft_checked_documents (             -- backs not_mentioned: the proof of an absence
  assessment_id       uuid not null,
  tenant_id           uuid not null,
  election_id         uuid not null,
  source_document_id  uuid not null,                   -- must have a stored copy
  checked_at          timestamptz not null default now(),  -- set by trigger; not before the copy was stored
  checked_by          uuid not null,
  primary key (assessment_id, source_document_id),
  foreign key (tenant_id, assessment_id, election_id)      references app.assessments (tenant_id, id, election_id),
  foreign key (tenant_id, election_id, source_document_id) references app.source_documents (tenant_id, election_id, id)
);

create table app.review_events (                       -- private review trail; append-only
  id             uuid primary key default uuidv7(),
  tenant_id      uuid not null,
  assessment_id  uuid not null,
  kind           app.review_event_kind not null,
  actor_id       uuid not null,
  note           text,
  created_at     timestamptz not null default now(),
  foreign key (tenant_id, assessment_id) references app.assessments (tenant_id, id)
);
```

**Who writes a cell.** Editors and country admins write the draft content (rating, summary, change kind and note,
quotes, checked documents) and delete never-published cells, with their drafts and contributor rows; every member reads
cells. Reviewers change only what reviewing needs: the cell's state, and attesting a quote
(`private.restrict_columns`). Video and audio positions (`ts_start`, `ts_end`) are seconds (`numeric(10, 3)`), here and
in the published copy, rather than `interval`, which has no plain JSON or TypeScript form.

**Content is locked while in review.** Any content change to a cell in `in_review` is rejected; an editor first
recalls it to `draft`. Every content-changing trigger and the publish trigger lock the cell row (`for update`), so
an edit can't slip in between the reviewer's check and the copy.

**How the workflow is enforced** (`private.assessment_transition()` before an update of a cell,
`private.assessment_trail()` after a write, `private.cell_content_changed()` after a write of a quote or checked
document):

- A change to a quote or checked document locks its cell and then _touches_ it: a nested `SET state = 'draft'` that
  changes nothing else, which the cell's trigger counts as an edit (only at trigger depth > 1, so a caller can't
  fake one). An edit checks the lock, bumps `content_version`, returns a published cell to draft and adds the editor
  as a contributor. Attesting a quote, or what the match trigger computes, is not an edit.
- Submitting needs `editor` or `country_admin` (or a platform admin). Coming back from review is a recall when the
  actor is a contributor of the generation; otherwise it is a rejection, which needs `reviewer` or `country_admin`
  and a note: a comment the rejecter writes on the cell in the same transaction, copied into the `rejected` event.
- Only the table owner sets a cell `published`, which only the `SECURITY DEFINER` publish trigger runs as. That
  update changes nothing else; the transition trigger then starts the next generation and clears the change kind and
  note (§3.6 step 9). A published cell goes back to draft only by an edit.
- `review_events` other than comments are written by these triggers only: the insert policy admits other kinds only
  at trigger depth > 0. Review events are immutable, so a cell with a review trail is never deleted.
- In an archived election, no new cell is created, and a cell's content changes only while its draft is a
  correction or a withdrawal (PLAN P16).
- Ratings are checked against the tenant's methodology kind when written. Submitting checks everything publishing
  will: the change kind and default-locale note after the first publish (none before it), a rating and a
  default-locale summary unless withdrawing, and the evidence (a quote, or for "not mentioned" a checked, stored
  copy of the party's own document of a kind the methodology lists). Every quote must be matched or attested and
  every source still of a kind the methodology lists, since the methodology can change after a quote is written.

**Attestation** (`private.evidence_rules()`). Any member other than the quote's author attests (the author too, once a
platform admin turns off the election's second-reviewer setting; otherwise it is a permission error). It is set once:
withdraw it (`attested_by = null`) before someone else attests. Any content change of the quote undoes it, and every
update of the quote checks it again, so one that no longer holds (say, the author's, once a second reviewer is
required again) lapses to `unmatched`.

### 3.6 Published revisions (immutable)

**Publishing is one INSERT that names the cell and the version reviewed:**

```sql
insert into app.assessment_revisions (assessment_id, reviewed_version) values ($1, $2);
```

Runtime roles may insert only those two columns. A `SECURITY DEFINER` trigger, `private.publish_revision()` (on the
ADR-0002 allowlist), does the rest in the same transaction:

1. Locks the cell, and requires `state = 'in_review'` and `content_version = reviewed_version`.
2. Requires the election to be `live`, or `archived` for a correction or withdrawal, and outside its freeze window.
3. Requires the publisher to hold `reviewer` or `country_admin` in the tenant (or be a platform admin), at aal2.
4. Takes the generation's contributors, plus the uploaders of uploaded files the draft cites. There must be at least
   one. If the election requires a second reviewer, the publisher must not be among them; otherwise the revision
   is recorded as `self_reviewed`.
5. Checks the change kind: `initial` for the first revision only. Every later one carries the draft's
   `update`, `correction` or `withdrawal`, and a public note with default-locale text.
6. Re-runs the verbatim match for every quote, and the attestation rules, rather than trusting stored statuses.
7. Checks the evidence requirement (ADR-0002): a rating other than `not_mentioned` needs at least one matched or
   attested quote from an admissible source kind. `not_mentioned` needs at least one checked document that is the
   party's own, of a kind the methodology lists for it, with a stored copy.
8. Copies the rating, summary, change kind, note, evidence (with the matched units' labels) and checked documents;
   sets `revision_no` and `published_at`; writes `revision_internal`.
9. Moves the cell to `published`, increments its `generation` and clears the draft change kind and note.

Nothing here is ever updated or deleted, except through `purge_tenant`.

**How the publish trigger is built.** One function runs before the insert (steps 1–7, then filling in the revision)
and after it (copying, `revision_internal`, and setting the cell `published`, whose own trigger does step 9). It
checks the publisher first, so nobody else learns anything about the cell. A missing role or a four-eyes violation is
a permission error (42501); the cell's state, the version, the election's status and the freeze window are
`restrict_violation` (23001); what the content lacks is `check_violation` (23514). The contributors include whoever
uploaded a source copy or an attestation file the draft cites. Step 6 is a no-op update of the draft's quotes, which
makes their trigger match and check attestations again. A matched quote's location is its units' labels (`p. 47`, or
`p. 47–p. 48`); an attested one's is its section label. Publishing does not need an active tenant: an inactive
tenant's revisions are simply not public.

```sql
-- Every column but assessment_id and reviewed_version is set by the publish trigger.
create table app.assessment_revisions (                -- public
  id                uuid primary key default uuidv7(),
  tenant_id         uuid not null,
  assessment_id     uuid not null,
  election_id       uuid not null,
  party_id          uuid not null,
  criterion_id      uuid not null,
  reviewed_version  int not null,
  revision_no       int not null,
  rating            app.rating,                        -- null only for a withdrawal
  summary           jsonb,                             -- localized; null only for a withdrawal
  change_kind       app.change_kind not null,
  public_note       jsonb,                             -- required unless change_kind = 'initial'
  published_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, id, election_id),
  unique (assessment_id, revision_no),
  check ((change_kind = 'withdrawal') = (rating is null)),
  check ((change_kind = 'initial') = (revision_no = 1)),
  check (change_kind = 'initial' or public_note is not null),
  -- The copied election, party and criterion must be the cell's own: public visibility follows election_id.
  foreign key (tenant_id, assessment_id, election_id, party_id, criterion_id)
    references app.assessments (tenant_id, id, election_id, party_id, criterion_id)
);

create table app.revision_evidence (                   -- public; written only by the publish trigger
  revision_id         uuid not null,
  tenant_id           uuid not null,
  election_id         uuid not null,
  ordinal             int not null,
  source_document_id  uuid not null,
  quote               text not null,
  location_label      text,                            -- the matched units' labels, a section, or timestamps
  ts_start            numeric(10, 3),                  -- seconds
  ts_end              numeric(10, 3),
  match_status        app.match_status not null check (match_status in ('matched', 'attested')),
  primary key (revision_id, ordinal),
  foreign key (tenant_id, revision_id, election_id)
    references app.assessment_revisions (tenant_id, id, election_id),
  foreign key (tenant_id, election_id, source_document_id) references app.source_documents (tenant_id, election_id, id)
);

create table app.revision_checked_documents (          -- public; written only by the publish trigger
  revision_id         uuid not null,
  tenant_id           uuid not null,
  election_id         uuid not null,
  source_document_id  uuid not null,
  checked_at          timestamptz not null,
  primary key (revision_id, source_document_id),
  foreign key (tenant_id, revision_id, election_id)
    references app.assessment_revisions (tenant_id, id, election_id),
  foreign key (tenant_id, election_id, source_document_id) references app.source_documents (tenant_id, election_id, id)
);

create table app.revision_internal (                   -- private: who did what; written only by the publish trigger
  revision_id      uuid primary key,
  tenant_id        uuid not null,
  contributor_ids  uuid[] not null check (cardinality(contributor_ids) > 0),
  reviewer_id      uuid not null,                      -- the publisher
  self_reviewed    boolean not null,                   -- private, never shown publicly
  provenance       jsonb not null,                     -- per quote: author, origin, LLM suggestion, attester
  report_id        uuid,                               -- the right-of-reply report that prompted it, if any
  check (self_reviewed = (reviewer_id = any (contributor_ids))),
  foreign key (tenant_id, revision_id) references app.assessment_revisions (tenant_id, id),
  foreign key (tenant_id, report_id)   references app.reports (tenant_id, id)
);
```

**Derived views** (all `security_invoker`, so the reader's RLS applies):

- `app.current_revisions`: the latest revision per assessment (`distinct on (assessment_id) … order by revision_no
desc`). A cell with no revision is _pending_; one whose latest revision is a withdrawal is _withdrawn_. Neither
  shows a rating; their public wording is PLAN P7's.
- `app.corrections_log`: per election, every non-initial revision plus every `structural_changes` row (§3.7),
  newest first. It is derived and never written to directly, and it reads only public tables.

### 3.7 Change control for live elections

Once an election is `live`, everything public about its structure changes only through an approved change request:
the election's name and date; every methodology column (the kind and the territory never change once live);
methodology reviewers; every party column except the programme status; every criterion column. Parties, criteria
and reviewers are added or retired through change requests too, never deleted. Adding parties is for appeals and
late candidacies (PLAN Q5).

```sql
create table app.change_requests (                     -- private; immutable once decided
  id              uuid primary key default uuidv7(),
  tenant_id       uuid not null,
  election_id     uuid not null,
  action          app.change_action not null,
  target_kind     text not null
    check (target_kind in ('election', 'methodology', 'methodology_reviewer', 'party', 'criterion')),
  target_id       uuid,                                -- null for 'add'; trigger: in this tenant and election
  field           text,                                -- for 'update': the column
  previous_value  jsonb,                               -- set by trigger from the target, never from the caller
  proposed_value  jsonb,                               -- the new value ('update') or the new row ('add')
  public_note     jsonb not null,                      -- always required: it is published with the change
  report_id       uuid,                                -- the right-of-reply report that prompted it, if any
  state           app.change_request_state not null default 'pending',
  proposed_by     uuid not null,
  proposed_at     timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decided_txid    xid8,                                -- set by trigger to pg_current_xact_id() on approval
  unique (tenant_id, id),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id),
  foreign key (tenant_id, report_id)   references app.reports (tenant_id, id),
  check ((action = 'update') = (field is not null)),
  check ((action = 'add') = (target_id is null))
);

-- The public record of each approved change, written by the approval trigger. Immutable.
create table app.structural_changes (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null,
  election_id        uuid not null,
  change_request_id  uuid not null unique,
  action             app.change_action not null,
  target_kind        text not null,
  target_id          uuid not null,                    -- for 'add', the new row
  field              text,
  previous_value     jsonb,
  new_value          jsonb,
  public_note        jsonb not null,
  approved_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, election_id)       references app.elections (tenant_id, id),
  foreign key (tenant_id, change_request_id) references app.change_requests (tenant_id, id)
);
```

**After insert,** a change request can change only once: `state` from `pending` to `approved` or `rejected`, with
`decided_by`, `decided_at` and `decided_txid`. Nothing else, and no delete once decided. The approver can't alter
what they approve.

**Who approves** depends on the tenant's `live_edits_need_second_approver`, which only a platform admin sets:

- **Off (the default):** one member can propose and approve their own change in one step. It still needs a public
  note and still appears in the corrections log, so live changes stay visible to the public.
- **On:** a different member must approve (`decided_by <> proposed_by`, checked by trigger).

Either way the approver holds `reviewer` or `country_admin`. **How the edit happens:** the approval trigger applies
the change to its target as the approver and writes the `structural_changes` row. The trigger on `elections`,
`methodologies`, `methodology_reviewers`, `parties` and `criteria` accepts a change-controlled write to a live
election only if an `approved` request for exactly that target, action, field and value has
`decided_txid = pg_current_xact_id()`, i.e. it was approved in the same transaction. There is no session flag to
set, so the rule can't be switched off from a connection. Approvals are blocked inside the election's freeze
window.

**How it is enforced** (`private.change_request_rules()` before an insert or update of a request and after an
approval; `private.change_control()` after any write to the five structure tables):

- Proposals are for live elections only (a draft's structure is edited directly). The target must be in the request's
  election; `update` names a change-controlled column (the election's name and date; the methodology's demands owner,
  body and source kinds; every reviewer, party and criterion column but slugs and the programme status); `add` and
  `retire` are for reviewers, parties and criteria only. Proposed values are normalized to how the column stores them,
  and `previous_value` is read from the target.
- A decision sets the state once, with `decided_by`, `decided_at` and, for an approval, `decided_txid`. An approval
  also needs the target unchanged since the proposal (otherwise propose again), default-locale text in the note and in
  any localized value, no freeze, and (with `live_edits_need_second_approver`) an approver other than the proposer.
- The approver applies the change with their own rights, so reviewers, who write no structure, approve nothing that
  needs it (a permission error); in practice country admins and platform admins approve. A write that changes no row
  is refused too. The `structural_changes` row is inserted by the same trigger: the insert policy admits it only at
  trigger depth > 0.
- An addition matches an approved, not-yet-recorded `add` request whose columns the new row has; once recorded, the
  request authorizes nothing more.
- `proposed_value`, `previous_value` and `new_value` can hold an external reviewer's name, so they are commented
  `personal data` and never audited; `structural_changes` is itself the public record.
- `app.corrections_log` has one row per entry: `entry_kind` (`revision` or `structural_change`), `entry_id`, `at`,
  `change` (the change kind or action), the cell, or the target kind, id and field with the previous and new values,
  and the public note.

### 3.8 Right of reply (personal data: private, anonymized)

```sql
create table app.reports (
  id                       uuid primary key default uuidv7(),
  tenant_id                uuid not null references app.tenants,
  election_id              uuid,
  assessment_id            uuid,
  kind                     app.report_kind not null,
  name                     text,                       -- personal data
  email                    text,                       -- personal data
  organization             text,                       -- personal data
  is_party_representative  boolean not null default false,
  message                  text,                       -- personal data (free text); null once anonymized
  status                   app.report_status not null default 'new',
  created_at               timestamptz not null default now(),
  triaged_by               uuid,
  triaged_at               timestamptz,
  resolution_note          text,                       -- personal data (it may quote the report)
  anonymize_after          date not null,              -- created_at + tenants.report_retention_days
  anonymized_at            timestamptz,
  unique (tenant_id, id),
  check (assessment_id is null or election_id is not null),
  check (message is not null or anonymized_at is not null),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id),
  foreign key (tenant_id, assessment_id, election_id) references app.assessments (tenant_id, id, election_id)
);

-- Per-tenant daily cap, used by submit_report(). It is a backstop: the per-IP rate limit at the gateway comes
-- first. A flood can still use up a day's cap for everyone; that is accepted, and the cap is sized well above
-- normal use.
create table app.report_daily_counts (
  tenant_id  uuid not null references app.tenants,
  day        date not null,
  count      int not null,
  primary key (tenant_id, day)
);
```

**Anonymization instead of deletion.** Corrections and change requests cite reports, and published history can't
lose a reference, so reports are never deleted (except by `purge_tenant`). At `anonymize_after`, or on an erasure
request, the personal-data columns are set to null and `anonymized_at` is set; the report's kind, status, dates and
links stay. The daily run is `private.anonymize_expired_reports()`, a `SECURITY DEFINER` function that takes no
arguments and that only `aiontheballot_worker` can execute (ADR-0002 allowlist). A country admin's erasure is an
UPDATE that the trigger accepts only if it nulls exactly those columns. Reports stay triageable when their election
is archived.

**Sending and triaging** (`app.submit_report()`, `private.report_rules()`):

- `app.submit_report(tenant, kind, message, election, assessment, name, email, organization,
is_party_representative)` is the public's only write and returns the report's id. It refuses an inactive or unknown
  tenant, an election that is not the tenant's or not live or archived, and a cell of another election, all as
  `invalid_parameter_value` (22023), and a tenant past its daily cap (200 reports per UTC day, a constant in the
  function) as `program_limit_exceeded` (54000). It trims the text fields and lowercases the email; checks on the
  table bound their lengths and the email's shape. `anonymize_after` is the UTC day it was sent plus the tenant's
  `report_retention_days`.
- Editors, reviewers and country admins triage: `new → triaged → accepted | rejected | spam`, each step once;
  `triaged_by` and `triaged_at` are set at `new → triaged`. Only the status and the resolution note change; what was
  sent never does. Platform admins neither read nor triage reports.
- Anonymizing sets all five personal-data columns to null in one update that changes nothing else; `anonymized_at` is
  the transaction time and is set once. Country admins do it on request; the daily run does it as the table owner.
  Afterwards the report takes no personal data again, but its status can still change.

### 3.9 LLM assistance (M4; the schema exists from M1)

```sql
create table app.llm_runs (
  id                  uuid primary key default uuidv7(),
  tenant_id           uuid not null,
  election_id         uuid not null,
  source_document_id  uuid not null,
  requested_by        uuid not null,
  model               text not null,
  prompt_version      text not null,
  status              text not null check (status in ('queued', 'running', 'done', 'failed')),
  started_at          timestamptz,
  finished_at         timestamptz,
  input_tokens        int,
  output_tokens       int,
  cost_usd            numeric(10, 4),
  error               text,
  created_at          timestamptz not null default now(),  -- the month its cost counts towards
  unique (tenant_id, id),
  unique (tenant_id, id, election_id),
  unique (tenant_id, id, source_document_id),
  foreign key (tenant_id, election_id, source_document_id) references app.source_documents (tenant_id, election_id, id)
);

create table app.llm_suggestions (
  id                uuid primary key default uuidv7(),
  tenant_id         uuid not null,
  election_id       uuid not null,
  run_id            uuid not null,
  party_id          uuid not null,
  criterion_id      uuid not null,
  suggested_rating  app.rating not null,
  rationale         text not null,
  passages          jsonb not null,                    -- [{quote, unit_index, matched}]; unmatched ones never shown
  state             app.suggestion_state not null default 'open',
  decided_by        uuid,
  decided_at        timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, run_id, election_id)       references app.llm_runs (tenant_id, id, election_id),
  foreign key (tenant_id, election_id, party_id)     references app.parties (tenant_id, election_id, id),
  foreign key (tenant_id, election_id, criterion_id) references app.criteria (tenant_id, election_id, id)
);
```

A run is refused once the tenant's spend this month (the sum of `cost_usd` of runs created this UTC month) reaches
`tenants.llm_monthly_cap_usd`; a cap of 0 turns LLM assistance off. A run moves queued → running → done or failed,
with its start and finish stamped, and only its progress changes. A suggestion is open when written, with a rating of
the tenant's scale, and is accepted or rejected once, by the actor, at the transaction time.

### 3.10 Jobs

```sql
-- What a background job is for. The API inserts it inside withActor, so RLS checks the actor's membership and the
-- foreign keys pin the target to that tenant. The pg-boss payload carries only this id. The worker scopes itself to
-- that one request (app.job_request_id), never to a tenant, and a finished request authorizes nothing.
create table app.job_requests (
  id                  uuid primary key default uuidv7(),
  tenant_id           uuid not null references app.tenants,
  kind                app.job_kind not null,
  source_document_id  uuid not null,
  llm_run_id          uuid,                            -- for kind = 'llm_run'
  requested_by        uuid not null,
  created_at          timestamptz not null default now(),
  finished_at         timestamptz,                     -- set once, by the worker
  unique (tenant_id, id),
  check ((kind = 'llm_run') = (llm_run_id is not null)),
  foreign key (tenant_id, source_document_id) references app.source_documents (tenant_id, id),
  foreign key (tenant_id, llm_run_id, source_document_id) references app.llm_runs (tenant_id, id, source_document_id)
);
```

### 3.11 Audit

```sql
create table app.audit_log (                           -- append-only; no personal data
  id          bigint generated always as identity primary key,
  tenant_id   uuid,                                    -- null for platform-level actions
  actor_id    uuid,
  action      text not null,                           -- 'insert', 'update' or 'delete' (the private.audit trigger)
  table_name  text not null,
  row_id      text not null,                           -- the primary key; a JSON object when composite
  diff        jsonb,                                   -- {new} | {old, new} (changed columns only) | {old};
                                                       -- never includes columns commented 'personal data'
  at          timestamptz not null default now()
);

create table app.purge_log (                           -- written only by purge_tenant(); platform admins read it
  id                  bigint generated always as identity primary key,
  purged_tenant_id    uuid not null,                   -- no foreign key: the tenant is gone
  purged_tenant_slug  text not null,
  purged_by           text not null,                   -- the database role that ran it
  counts              jsonb not null,                  -- rows deleted, by table
  leftovers           jsonb not null,                  -- organizations and users the tenant leaves unused
  at                  timestamptz not null default now()
);
```

**Purge** deletes everything of the tenant, its audit rows included, and keeps one `purge_log` row. Its hostnames
move to `hostname_tombstones`. Organizations used by no other tenant, and users with no other membership, are listed
in the purge record (`leftovers`) for a platform admin to remove. While purging, the audit and cache-key triggers skip
writes, but only in a session whose role is a member of the table owner (`private.purging()`), so a runtime role
that sets `app.purge` changes nothing. The purge refuses to finish if any table with a `tenant_id` still holds a row of
the tenant, so a table added later can't be forgotten silently. **Export** of one tenant is a query per table filtered on
`tenant_id`, which every tenant-owned table has; the runbook comes with M5.

## 4. State machines

**Election:**

```text
draft ──(go live: operator set, tenant active, methodology complete, default-locale texts present)──▶ live
live ──(archive)──▶ archived
```

- `went_live_at` is set on going live. Revisions are published only while an election is `live`, plus corrections
  and withdrawals once it is archived. Nothing is published in `draft`, so no test revision becomes history.
- **Freeze window** (PLAN Q8): from `frozen_from` until `frozen_until` (or until cleared), nothing public about the
  election changes: no revision, no change-request approval, no programme-status update. Only a `country_admin`
  sets or clears it, audited. Whether and when to use it is the chapter's call.
- **Archived:** read-only, except corrections and withdrawals (with the same review rule and a public note) and
  report handling.
- **`require_second_reviewer`** is on by default. Only a platform admin turns it off, audited; ADR-0002 records why.
- **Once live,** slugs, the type and the territory are fixed; an archived election and its structure are read-only.
  A tenant's methodology kind is fixed once it has a methodology, and its country code while its territories use it.
  These rules fire after the permission guards, so a writer without the right is refused as such first.

**Assessment (a cell):**

```text
(none) ──create──▶ draft
draft ──submit──▶ in_review       content locked; needs a rating valid for the methodology kind (or a withdrawal),
                                  the change kind and note after the first publish, and evidence or checked
                                  documents as the publish trigger will require
in_review ──recall──▶ draft       by a contributor, to edit again
in_review ──reject (note)──▶ draft
in_review ──approve──▶ published  the publish INSERT (§3.6); the next generation starts
published ──edit──▶ draft         the public keeps seeing the latest revision until the next approval
```

A withdrawal is a draft like any other (`draft_change_kind = 'withdrawal'`, no rating), so it goes through the same
review.

**Change request:** `pending → approved | rejected`, once. Approval applies the change and writes its public record
in the same transaction. Whether the proposer may approve their own request is the tenant's setting (§3.7).

**Report:** `new → triaged → accepted | rejected | spam`. Separately, anonymized at `anonymize_after` or on request.
An accepted report is linked from the revision or change request it caused.

**Source:** created → stored copy set once (fetch job or upload) → `extraction_status` from `pending` to `done`,
`failed` or `not_applicable` → archive snapshot set once.

**Hostname:** inserted unverified → `verified_at` set → may become canonical → may be retired. Never deleted; a
purge moves it to `hostname_tombstones`.

## 5. Public read model (what `aiontheballot_web` can read)

| Relation                                                                     | Visible rows                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `tenants`                                                                    | Active tenants (all columns but the settings)                                      |
| `tenant_hostnames`, `hostname_tombstones`                                    | Verified hostnames of active tenants; all tombstones                               |
| `organizations`, `tenant_organizations`, `core_criteria`                     | Those of active tenants; all core criteria                                         |
| `tenant_brand_selections`, `brand_assets`                                    | Selections of active tenants; unrestricted assets and the selected restricted ones |
| `tenant_documents`                                                           | Published versions of active tenants                                               |
| `public_versions`                                                            | Active tenants                                                                     |
| `elections`, `methodologies`, `methodology_reviewers`, `parties`, `criteria` | Rows of `live` or `archived` elections of active tenants                           |
| `assessment_revisions`, `revision_evidence`, `revision_checked_documents`    | Same; the full revision history is public                                          |
| `structural_changes`                                                         | Same                                                                               |
| `source_documents`                                                           | Cited by a public revision; public columns only (below)                            |
| `files` (their bytes are on the file volume)                                 | `public_assets` images a public row shows (a party logo, a brand selection)        |
| `current_revisions`, `corrections_log`                                       | Through the rules above (`security_invoker`)                                       |

Column-level grants restrict `aiontheballot_web` further: on `source_documents` it reads only `id`, `election_id`,
`party_id`, `kind`, `title`, `url`, `language`, `is_programme`, `sha256`, `retrieved_at` and `archive_url`; on
`tenants` and `elections`, not the settings columns.

**Never readable by `aiontheballot_web`:**

- `assessments`, `draft_*`, `assessment_contributors`, `review_events`, `revision_internal`, `change_requests`;
- `source_texts` and the `sources` bucket (copyright);
- `reports`, `report_daily_counts`;
- `invitations`, `memberships`, `platform_admins`, `platform_hostnames`, `hostname_verifications`,
  `brand_asset_grants`;
- `llm_*`, `job_requests`, `audit_log`, `purge_log`.

The only write available to `aiontheballot_web` is calling `app.submit_report()`.

These public-visibility policies are for `aiontheballot_web` only. `aiontheballot_admin` sees what memberships give it
(platform admins: every tenant), and nothing of other tenants, published or not (PLAN, Answered: admin visibility).
Members also read the unrestricted brand-asset catalogue, to choose their tenant's logos from it.

## 6. Enforcement map

| Rule (ADR-0002 / BRIEF)                                                                                        | Mechanism                                                                                                                  | Where                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Tenant id never changes                                                                                        | `BEFORE UPDATE` trigger                                                                                                    | Every tenant-owned table                                                                              |
| No cross-tenant references                                                                                     | Composite foreign keys                                                                                                     | Every child table                                                                                     |
| No cross-election references within a tenant                                                                   | `(tenant_id, election_id, …)` foreign keys                                                                                 | Every election-scoped child table                                                                     |
| One party's sources never back another party's cell                                                            | Trigger: the source's `party_id` is null or the cell's party                                                               | `draft_evidence`, `draft_checked_documents`                                                           |
| Actors are who they say they are                                                                               | Trigger sets each actor column at its moment (§1)                                                                          | Every table with an actor column                                                                      |
| Nothing is backdated                                                                                           | Trigger sets event timestamps to the transaction time (§1)                                                                 | Every table with an event timestamp                                                                   |
| Published content is the reviewed draft                                                                        | Column-level INSERT grant; `private.publish_revision()` copies the in-review draft at the version reviewed                 | `assessment_revisions`, revision child tables                                                         |
| Four-eyes (when the election requires it); publisher identity                                                  | Publish trigger: publisher not among the generation's contributors and uploaders; at least one contributor; role and aal2  | `assessment_revisions`, `revision_internal`                                                           |
| Only platform admins turn off four-eyes                                                                        | Trigger, plus an audit row                                                                                                 | `elections`                                                                                           |
| Contributors can't be hidden                                                                                   | Rows added by triggers on every content change, deletes included; only the current user's own row; no `UPDATE` or `DELETE` | `assessment_contributors`                                                                             |
| Content is locked in review                                                                                    | Trigger rejects content changes unless the cell is `draft`; row lock on every content change and on publish                | `assessments`, `draft_evidence`, `draft_checked_documents`                                            |
| Change kind and note are honest                                                                                | `initial` only for revision 1; the kind and note come from the reviewed draft                                              | `assessment_revisions`                                                                                |
| Change-request targets belong to the same tenant and election                                                  | Trigger                                                                                                                    | `change_requests`                                                                                     |
| Change requests can't be rewritten                                                                             | Trigger: after insert, only the one decision; no delete once decided; `previous_value` read from the target                | `change_requests`                                                                                     |
| Live structural changes are public                                                                             | The approval trigger writes an immutable public row                                                                        | `structural_changes`                                                                                  |
| Exactly one operator                                                                                           | Partial unique index, plus a deferred check whenever a tenant is active (activation, and any later change)                 | `tenant_organizations`, `tenants`                                                                     |
| Only platform admins change the operator, the methodology kind or `is_pauseai_chapter`, or write organizations | RLS (organizations, links); `members_may_change()` (tenants); an audit row                                                 | `tenant_organizations`, `tenants`, `organizations`                                                    |
| A methodology uses the tenant's kind; its demands owner is the operator or an endorser                         | Trigger                                                                                                                    | `methodologies`                                                                                       |
| A demands methodology names its owner                                                                          | `CHECK`                                                                                                                    | `methodologies`                                                                                       |
| Restricted assets only for eligible tenants                                                                    | Deferred trigger on selections and logos, re-run when grants, operator, `is_pauseai_chapter` or `restricted` change        | `tenant_brand_selections`, `organizations`, `brand_asset_grants`, `tenant_organizations`              |
| Territory codes stay inside the tenant's country; fixed once live                                              | Format checks, plus a trigger on the country prefix and on `draft`                                                         | `elections`, `parties`                                                                                |
| Slugs are fixed once live; election slugs aren't locale-shaped                                                 | Trigger; `CHECK`                                                                                                           | `elections`, `parties`, `criteria`                                                                    |
| Hostname rules                                                                                                 | Checks, partial index, no-delete trigger, platform-host and tombstone rejection                                            | `tenant_hostnames`                                                                                    |
| Ratings must be valid for the kind                                                                             | Trigger                                                                                                                    | `assessments`, `assessment_revisions`, `llm_suggestions`                                              |
| Verbatim match                                                                                                 | Trigger computes `match_status` across units; the caller's value is ignored; re-run at publish                             | `draft_evidence`, publish trigger                                                                     |
| Attestation is by a named second person                                                                        | Trigger: a stored file in `sources`, `attested_by = current_user_id()`, not the quote's author (when four-eyes applies)    | `draft_evidence`                                                                                      |
| The matched text can't be edited                                                                               | `source_texts` written only by an open extraction job, never updated or deleted; sources' copies set once                  | `source_texts`, `source_documents`                                                                    |
| Stored files are what their hash says, and stay so                                                             | The store computes the hash and checks every read (ADR-0004); no `UPDATE`; `DELETE` only while unreferenced                | `files`, the file store                                                                               |
| Public files are vetted images                                                                                 | Content-type check; RLS: referenced by a public row                                                                        | `files`                                                                                               |
| Only admissible source kinds                                                                                   | Trigger checks the methodology's kinds (for ratings and for "not mentioned")                                               | `draft_evidence`, `draft_checked_documents`, publish trigger                                          |
| The evidence requirement                                                                                       | Publish trigger                                                                                                            | `assessment_revisions`                                                                                |
| Legal state transitions                                                                                        | Trigger                                                                                                                    | `assessments`, `elections`, `change_requests`, `reports`, `source_documents`                          |
| Published data is immutable                                                                                    | `UPDATE`, `DELETE` and `TRUNCATE` triggers, honouring only `app.purge`                                                     | `assessment_revisions`, `revision_*`, `structural_changes`, `review_events`, `audit_log`, `purge_log` |
| Live-election structural edits need an approved change request                                                 | Trigger allows them only if a matching request was approved in the same transaction (`decided_txid`); no session flag      | `elections`, `methodologies`, `methodology_reviewers`, `parties`, `criteria`                          |
| Second approver for live edits, if the tenant requires it                                                      | Trigger: `decided_by <> proposed_by` when `live_edits_need_second_approver`; only platform admins set it                   | `change_requests`, `tenants`                                                                          |
| Freeze window                                                                                                  | Trigger: no public-visible change inside the window; only country admins set it                                            | Publish trigger, `change_requests`, `parties`, `elections`                                            |
| Archived elections are read-only, except corrections and reports                                               | Trigger                                                                                                                    | Every election-scoped table                                                                           |
| Default-locale text is present when public                                                                     | Trigger on publish, on going live, on approval and on writing a public election's criteria                                 | `assessment_revisions`, `elections`, `change_requests`, `tenant_documents`, `criteria`                |
| A programme marked published has a source; "not mentioned" gets rechecked                                      | Trigger                                                                                                                    | `parties`                                                                                             |
| Report cap and status                                                                                          | `submit_report()`, using the daily counts                                                                                  | `reports`, `report_daily_counts`                                                                      |
| Reports are anonymized, never deleted                                                                          | `anonymize_expired_reports()`; trigger allows only nulling the personal-data columns                                       | `reports`                                                                                             |
| The worker acts only within the job it runs                                                                    | RLS scoped to `app.job_request_id`, an open request; tenant and document read from the request                             | `job_requests` and the job tables                                                                     |
| No personal data in the audit log                                                                              | Audit trigger skips columns commented `personal data`; catalog test                                                        | `audit_log`                                                                                           |
| The public cache follows public changes                                                                        | `private.bump_public_version()` (`SECURITY DEFINER`) on every public-readable table                                        | `public_versions`                                                                                     |

Each row has a matching test, either in the data-rule list or in the matrix (ADR-0002).

## 7. Indexes

- Every foreign key column, and `(tenant_id, …)` leading composites.
- `assessment_revisions (assessment_id, revision_no desc)` for `current_revisions`.
- `structural_changes (election_id, approved_at desc)` for the corrections log.
- `reports (anonymize_after) where anonymized_at is null` for the daily run.
- `source_texts` gets no trigram or full-text index yet. Matching is a substring search over one document's few
  hundred pages; add an index only if profiling says so.

## 8. Jobs (pg-boss)

- The migration Job creates the `pgboss` schema as owner, using pg-boss's construction SQL. Runtime roles never
  need `CREATE`.
- Only the API enqueues jobs, always inside `withActor`: it inserts a `job_requests` row (§3.10) and puts only that
  row's id in the pg-boss payload.
- The worker runs as its own role, `aiontheballot_worker`. For each job it sets `app.job_request_id`, and
  `app.user_id` to the request's requester (what it writes is stamped and audited as theirs; its policies accept no
  one else). Its RLS admits only the open request, its tenant and its source document; every worker policy requires the
  request to be open, so finishing it (`finished_at`, once) ends what it authorizes at once. A trigger limits what each
  kind may change on the source. By kind:

  | Kind             | Reads                                             | Writes                                                     |
  | ---------------- | ------------------------------------------------- | ---------------------------------------------------------- |
  | `fetch_source`   | The source's URL                                  | A `sources` file (bytes, then row), then the source's copy |
  | `extract_source` | The source's file                                 | `source_texts`, then `extraction_status`                   |
  | `archive_source` | The source's URL                                  | `archive_url` (once)                                       |
  | `llm_run`        | Source texts, the election's criteria and parties | `llm_runs`, `llm_suggestions`                              |

- Fetching runs only in the worker, never in the API (hostile HTML and PDFs, threat A8).
- Separately, the worker runs `private.anonymize_expired_reports()` daily (§3.8). It needs no job request.

## 9. Open items

1. ~~**Worker database role.**~~ **Decided:** `aiontheballot_worker`, scoped to one job request at a time (§8).
2. **Better Auth tables.** They should sit in the `auth` schema with uuid ids (its `generateId` configured), if its
   Postgres adapter supports a non-default schema cleanly. The spike will confirm. Otherwise the fallback is
   prefixed tables in a schema `aiontheballot_web` can't read.
3. **The descriptive scale** (PLAN P6): define `red` versus `not_mentioned`.
4. **Admissible sources** (PLAN Q9): both methodology lists default to `{pdf, web_page}` until the chapter decides.
5. **Party names localized?** They're assumed to be `jsonb`, because some coalitions use different names in
   co-official languages. If the chapter says names are always one string, they become `text`.
6. **Report retention** (PLAN Q7): the value of `tenants.report_retention_days`.
7. **Municipalities and territory containment.** ISO 3166-2 has no municipal codes, and the codes don't encode
   which province belongs to which region. When municipal coverage or containment checks are needed, a later
   migration adds a reference table `app.territories (code, parent_code, kind)` (INE codes for municipalities) and
   turns the territory columns into foreign keys to it. Existing ISO codes stay valid.
8. **Normalization drift.** `normalize_for_match` relies on Postgres's Unicode tables, which a major upgrade can
   change; stored `normalized` columns are not recomputed. The parity tests run against each new Postgres version,
   and a migration recomputes the column if they differ.
9. **Later, not blocked:** translation-only revisions (`change_kind = 'translation'`, kept out of the corrections
   log) when a second locale arrives; publishing party responses (not in the brief); per-election endorsers and
   dated reviewer attributions; whether marking a report as spam needs a reviewer (editorial workflow spec).
