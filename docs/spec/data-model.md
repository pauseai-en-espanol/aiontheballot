# Spec: data model

- **Status:** Reviewed by Dani; the basis for the M1 migrations
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
- **Localized text:** `jsonb` objects that map a locale to a string, e.g. `{"es": "…", "en": "…"}`.
  - `private.is_localized()` checks the shape.
  - The tenant's default locale must be present before anything goes public: at publish time, and when an election
    goes live.
- **Slugs:** lowercase, matching `^[a-z0-9]+(-[a-z0-9]+)*$`.
- **Emails:** stored lowercased (`check (email = lower(email))`).
- **Timestamps:** `created_at timestamptz not null default now()`. Mutable tables also get `updated_at`, kept by a
  trigger.
- **Deletes:** published data is never deleted. Drafts can be deleted. A whole tenant can be removed only through
  `private.purge_tenant()` (ADR-0002 §14).

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
| `change_kind`          | `initial`, `update`, `correction`, `withdrawal`                                        |                                                                    |
| `source_kind`          | `pdf`, `web_page`, `social_post`, `video`, `audio`, `party_submission`                 |                                                                    |
| `match_status`         | `unmatched`, `matched`, `attested`                                                     |                                                                    |
| `extraction_status`    | `pending`, `done`, `failed`, `not_applicable`                                          |                                                                    |
| `programme_status`     | `pending`, `published`                                                                 |                                                                    |
| `file_bucket`          | `public_assets`, `sources`                                                             |                                                                    |
| `review_event_kind`    | `submitted`, `approved`, `rejected`, `withdrawn`, `commented`                          |                                                                    |
| `change_request_state` | `pending`, `approved`, `rejected`                                                      |                                                                    |
| `report_kind`          | `error_report`, `party_response`                                                       |                                                                    |
| `report_status`        | `new`, `triaged`, `accepted`, `rejected`, `spam`                                       |                                                                    |
| `suggestion_state`     | `open`, `accepted`, `rejected`                                                         |                                                                    |

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
  id               uuid primary key default uuidv7(),
  slug             text not null unique,                 -- 'es', 'test-a'
  default_locale   text not null,                        -- 'es'
  enabled_locales  text[] not null,                      -- public locales; must contain default_locale
  display_name     jsonb not null,                       -- localized
  theme            jsonb not null default '{}',          -- brand colours, logo file id; validated + contrast-checked
  active           boolean not null default false,
  created_at       timestamptz not null default now()
);

create table app.platform_hostnames (hostname text primary key);   -- reserved exact names: admin host, platform domain

create table app.tenant_hostnames (
  hostname      text primary key,                        -- lowercase ASCII/punycode, no port, no trailing dot
  tenant_id     uuid not null references app.tenants,
  is_canonical  boolean not null default false,
  verified_at   timestamptz,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (not is_canonical or verified_at is not null),
  check (not (is_canonical and retired_at is not null))
);
create unique index on app.tenant_hostnames (tenant_id) where is_canonical;

create table app.hostname_verifications (              -- private
  hostname         text primary key references app.tenant_hostnames,
  token_hash       text not null,
  last_checked_at  timestamptz,
  last_result      text
);

create table app.brand_assets (                        -- platform-global; content stored inline
  id            uuid primary key default uuidv7(),
  name          text not null,
  restricted    boolean not null default false,        -- e.g. a PauseAI mark
  content_type  text not null,
  sha256        text not null,
  content       bytea not null,
  created_at    timestamptz not null default now()
);

create table app.organizations (                       -- platform-global; public (legal notice)
  id                  uuid primary key default uuidv7(),
  display_name        jsonb not null,
  legal_name          text not null,
  tax_id              text,
  address             text,
  registry_entry      text,                            -- pending counsel (PLAN Q6)
  contact_email       text,
  url                 text,
  logo_asset_id       uuid references app.brand_assets,
  is_pauseai_chapter  boolean not null default false,  -- platform_admin only
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

create table app.tenant_brand_selections (
  tenant_id       uuid references app.tenants,
  slot            text not null,                       -- e.g. 'header_mark'
  brand_asset_id  uuid not null references app.brand_assets,
  primary key (tenant_id, slot)
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
  email        text not null check (email = lower(email)),
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

### 3.3 Elections, methodology, parties and criteria

```sql
create table app.elections (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null references app.tenants,
  slug               text not null,                    -- 'generales-2026'
  type               app.election_type not null,
  name               jsonb not null,
  election_date      date,
  status             app.election_status not null default 'draft',
  publishing_frozen  boolean not null default false,   -- the freeze switch (PLAN Q8)
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, slug)
);

create table app.methodologies (                       -- one per election
  id                       uuid primary key default uuidv7(),
  tenant_id                uuid not null,
  election_id              uuid not null unique,
  kind                     app.methodology_kind not null,
  demands_owner_id         uuid references app.organizations,
  body                     jsonb not null,             -- localized Markdown, sanitized on render
  admissible_source_kinds  app.source_kind[] not null default '{pdf,web_page}',  -- PLAN Q9
  unique (tenant_id, id),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id),
  check ((kind = 'demands') = (demands_owner_id is not null))
);

create table app.methodology_reviewers (               -- named external reviewers (public)
  id              uuid primary key default uuidv7(),
  tenant_id       uuid not null,
  methodology_id  uuid not null,
  name            text not null,
  affiliation     text not null,
  display_order   int not null default 0,
  foreign key (tenant_id, methodology_id) references app.methodologies (tenant_id, id)
);

create table app.parties (
  id                    uuid primary key default uuidv7(),
  tenant_id             uuid not null,
  election_id           uuid not null,
  name                  jsonb not null,                -- localized; see open item 5
  short_name            jsonb not null,
  logo_file_id          uuid,                          -- file in the public_assets bucket
  colour                text check (colour ~ '^#[0-9a-f]{6}$'),
  display_order         int not null,
  website               text,
  programme_status      app.programme_status not null default 'pending',
  programme_checked_at  timestamptz,                   -- "comprobado el …"
  unique (tenant_id, id),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id),
  foreign key (tenant_id, logo_file_id) references app.files (tenant_id, id)
);

create table app.criteria (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null,
  election_id        uuid not null,
  title              jsonb not null,
  description        jsonb not null,
  display_order      int not null,
  core_criterion_id  uuid references app.core_criteria,
  unique (tenant_id, id),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id)
);
```

### 3.4 Files and sources

```sql
create table app.files (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null references app.tenants,
  bucket             app.file_bucket not null,
  content_type       text not null,
  byte_size          bigint not null check (byte_size <= 52428800),   -- 50 MB
  sha256             text not null,
  original_filename  text,
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, bucket, sha256)                   -- the same file is stored once per tenant and bucket
);

create table app.file_blobs (
  file_id    uuid primary key,
  tenant_id  uuid not null,
  content    bytea not null,
  foreign key (tenant_id, file_id) references app.files (tenant_id, id)
);

create table app.source_documents (
  id                 uuid primary key default uuidv7(),
  tenant_id          uuid not null,
  election_id        uuid not null,
  party_id           uuid,                             -- null for sources not tied to one party
  kind               app.source_kind not null,
  title              text not null,                    -- as published, in its original language
  url                text,
  language           text,
  retrieved_at       timestamptz not null,
  archive_url        text,
  file_id            uuid,                             -- our stored copy (bucket: sources)
  extraction_status  app.extraction_status not null,
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id),
  foreign key (tenant_id, party_id) references app.parties (tenant_id, id),
  foreign key (tenant_id, file_id) references app.files (tenant_id, id)
);

create table app.source_texts (                        -- private: the full text is never public (copyright)
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

### 3.5 Assessments (cells): the working copy

```sql
create table app.assessments (
  id                   uuid primary key default uuidv7(),
  tenant_id            uuid not null,
  election_id          uuid not null,
  party_id             uuid not null,
  criterion_id         uuid not null,
  state                app.assessment_state not null default 'draft',
  draft_rating         app.rating,
  draft_summary        jsonb,
  current_revision_id  uuid,                           -- the latest published revision (null = pending)
  updated_by           uuid not null,
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  unique (party_id, criterion_id),
  foreign key (tenant_id, election_id)  references app.elections (tenant_id, id),
  foreign key (tenant_id, party_id)     references app.parties (tenant_id, id),
  foreign key (tenant_id, criterion_id) references app.criteria (tenant_id, id)
);

create table app.assessment_contributors (             -- everyone who edited since the last publish
  assessment_id  uuid not null,
  tenant_id      uuid not null,
  user_id        uuid not null,
  primary key (assessment_id, user_id),
  foreign key (tenant_id, assessment_id) references app.assessments (tenant_id, id)
);

create table app.draft_evidence (
  id                   uuid primary key default uuidv7(),
  tenant_id            uuid not null,
  assessment_id        uuid not null,
  source_document_id   uuid not null,
  ordinal              int not null,
  quote                text not null check (length(btrim(quote)) > 0),
  unit_index           int,                            -- the page or section (documents)
  section_label        text,
  ts_start             interval,                       -- video and audio
  ts_end               interval,
  match_status         app.match_status not null default 'unmatched',  -- set by trigger for pdf and web_page
  matched_unit_index   int,
  attested_by          uuid,
  attestation_file_id  uuid,
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, assessment_id)      references app.assessments (tenant_id, id),
  foreign key (tenant_id, source_document_id) references app.source_documents (tenant_id, id)
);

create table app.draft_checked_documents (             -- backs not_mentioned
  assessment_id       uuid not null,
  tenant_id           uuid not null,
  source_document_id  uuid not null,
  checked_at          timestamptz not null,
  checked_by          uuid not null,
  primary key (assessment_id, source_document_id),
  foreign key (tenant_id, assessment_id)      references app.assessments (tenant_id, id),
  foreign key (tenant_id, source_document_id) references app.source_documents (tenant_id, id)
);

create table app.review_events (                       -- private review trail
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

### 3.6 Published revisions (immutable)

Publishing copies the working copy into these tables in one transaction. Nothing here is ever updated or deleted,
except through `purge_tenant`.

```sql
create table app.assessment_revisions (                -- public
  id             uuid primary key default uuidv7(),
  tenant_id      uuid not null,
  assessment_id  uuid not null,
  election_id    uuid not null,
  party_id       uuid not null,
  criterion_id   uuid not null,
  revision_no    int not null,
  rating         app.rating,                           -- null only for a withdrawal
  summary        jsonb,                                -- localized; null only for a withdrawal
  change_kind    app.change_kind not null,
  public_note    jsonb,                                -- required unless change_kind = 'initial'
  published_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (assessment_id, revision_no),
  check ((change_kind = 'withdrawal') = (rating is null)),
  check (change_kind = 'initial' or public_note is not null),
  foreign key (tenant_id, assessment_id) references app.assessments (tenant_id, id)
);

create table app.revision_evidence (                   -- public
  revision_id         uuid not null,
  tenant_id           uuid not null,
  ordinal             int not null,
  source_document_id  uuid not null,
  quote               text not null,
  unit_index          int,
  section_label       text,
  ts_start            interval,
  ts_end              interval,
  match_status        app.match_status not null check (match_status in ('matched', 'attested')),
  primary key (revision_id, ordinal),
  foreign key (tenant_id, revision_id)        references app.assessment_revisions (tenant_id, id),
  foreign key (tenant_id, source_document_id) references app.source_documents (tenant_id, id)
);

create table app.revision_checked_documents (          -- public
  revision_id         uuid not null,
  tenant_id           uuid not null,
  source_document_id  uuid not null,
  checked_at          timestamptz not null,
  primary key (revision_id, source_document_id),
  foreign key (tenant_id, revision_id) references app.assessment_revisions (tenant_id, id)
);

create table app.revision_internal (                   -- private: who signed off, and why
  revision_id      uuid primary key,
  tenant_id        uuid not null,
  contributor_ids  uuid[] not null,
  reviewer_id      uuid not null,
  report_id        uuid,                               -- the right-of-reply report that prompted it, if any
  check (not reviewer_id = any (contributor_ids)),
  foreign key (tenant_id, revision_id) references app.assessment_revisions (tenant_id, id)
);
```

**Derived views** (all `security_invoker`, so the reader's RLS applies):

- `app.current_revisions`: the latest revision per assessment (`distinct on (assessment_id) … order by revision_no
desc`). A cell with no row, or whose latest revision is a withdrawal, shows as _pending_.
- `app.corrections_log`: per election, every non-initial revision, plus approved change requests, newest first.
  This replaces the `corrections` _table_ that ADR-0002 listed; the log is derived, never written to directly.

### 3.7 Change control for live elections

```sql
create table app.change_requests (
  id              uuid primary key default uuidv7(),
  tenant_id       uuid not null,
  election_id     uuid not null,
  target_kind     text not null check (target_kind in ('criterion', 'party', 'methodology')),
  target_id       uuid not null,
  field           text not null,                       -- e.g. 'title', 'name', 'body'
  previous_value  jsonb not null,
  proposed_value  jsonb not null,
  public_note     jsonb not null,
  state           app.change_request_state not null default 'pending',
  proposed_by     uuid not null,
  proposed_at     timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  check (decided_by is null or decided_by <> proposed_by),
  foreign key (tenant_id, election_id) references app.elections (tenant_id, id)
);
```

### 3.8 Right of reply (personal data: private, deletable)

```sql
create table app.reports (
  id                       uuid primary key default uuidv7(),
  tenant_id                uuid not null references app.tenants,
  election_id              uuid,
  assessment_id            uuid,
  kind                     app.report_kind not null,
  name                     text,
  email                    text,
  organization             text,
  is_party_representative  boolean not null default false,
  message                  text not null,
  status                   app.report_status not null default 'new',
  created_at               timestamptz not null default now(),
  triaged_by               uuid,
  triaged_at               timestamptz,
  resolution_note          text,
  delete_after             date not null,              -- the retention period (PLAN Q7)
  unique (tenant_id, id)
);

create table app.report_daily_counts (                 -- per-tenant daily cap, used by submit_report()
  tenant_id  uuid not null references app.tenants,
  day        date not null,
  count      int not null,
  primary key (tenant_id, day)
);
```

### 3.9 LLM assistance (M4; the schema exists from M1)

```sql
create table app.llm_runs (
  id                  uuid primary key default uuidv7(),
  tenant_id           uuid not null,
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
  unique (tenant_id, id),
  foreign key (tenant_id, source_document_id) references app.source_documents (tenant_id, id)
);

create table app.llm_suggestions (
  id                uuid primary key default uuidv7(),
  tenant_id         uuid not null,
  run_id            uuid not null,
  party_id          uuid not null,
  criterion_id      uuid not null,
  suggested_rating  app.rating not null,
  rationale         text not null,
  passages          jsonb not null,                    -- [{quote, unit_index, matched}]; unmatched ones never shown
  state             app.suggestion_state not null default 'open',
  decided_by        uuid,
  decided_at        timestamptz,
  foreign key (tenant_id, run_id) references app.llm_runs (tenant_id, id)
);
```

### 3.10 Audit

```sql
create table app.audit_log (                           -- append-only; no personal data
  id          bigint generated always as identity primary key,
  tenant_id   uuid,                                    -- null for platform-level actions
  actor_id    uuid,
  action      text not null,                           -- e.g. 'operator.changed', 'revision.published'
  table_name  text not null,
  row_id      text not null,
  diff        jsonb,
  at          timestamptz not null default now()
);

create table app.purge_log (                           -- written only by purge_tenant()
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null,
  purged_by  text not null,
  counts     jsonb not null,
  at         timestamptz not null default now()
);
```

## 4. State machines

**Election:**

```text
draft ──(go live: operator set, tenant active, methodology complete, default-locale texts present)──▶ live
live ──(archive)──▶ archived      (archived is read-only)
publishing_frozen = true blocks new revisions in a live election (reflection day, if the chapter wants it)
```

**Assessment (a cell):**

```text
(none) ──create──▶ draft
draft ──submit──▶ in_review       needs a rating that is valid for the methodology kind, and either
                                  ≥1 evidence item (matched, or attested by someone other than the publisher)
                                  or, for not_mentioned, ≥1 checked document
in_review ──reject (note)──▶ draft
in_review ──approve──▶ published  publisher ∉ contributors; publisher holds reviewer or country_admin;
                                  a new revision is inserted; current_revision_id is updated;
                                  contributors are cleared
published ──edit──▶ draft         the public keeps seeing current_revision_id until the next approval
published ──withdraw──▶ published a withdrawal revision is inserted (rating null); the cell shows "pending"
```

**Change request:** `pending → approved | rejected`. Approval applies the change to its target in the same
transaction.

**Report:** `new → triaged → accepted | rejected | spam`. An accepted report is linked from the
`revision_internal` row of the correction it caused.

**Hostname:** inserted unverified → `verified_at` set → may become canonical → may be retired. Never deleted.

## 5. Public read model (what `aiontheballot_web` can read)

| Relation                                                                     | Visible rows                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `tenants`                                                                    | Active tenants                                                                 |
| `tenant_hostnames`                                                           | Verified hostnames of active tenants                                           |
| `organizations`, `tenant_organizations`, `core_criteria`                     | All, for active tenants                                                        |
| `brand_assets`                                                               | Unrestricted assets, and restricted ones selected by an eligible active tenant |
| `elections`, `methodologies`, `methodology_reviewers`, `parties`, `criteria` | Rows of `live` or `archived` elections of active tenants                       |
| `assessment_revisions`, `revision_evidence`, `revision_checked_documents`    | Same; the full revision history is public                                      |
| `source_documents`                                                           | Metadata only (title, URL, dates, archive URL, kind) for the same elections    |
| `files` and `file_blobs`                                                     | Only the `public_assets` bucket (logos)                                        |
| `current_revisions`, `corrections_log`                                       | Through the rules above (`security_invoker`)                                   |

**Never readable by `aiontheballot_web`:**

- `assessments`, `draft_*`, `assessment_contributors`, `review_events`, `revision_internal`, `change_requests`;
- `source_texts` and the `sources` bucket (copyright);
- `reports`, `report_daily_counts`;
- `invitations`, `memberships`, `platform_admins`, `hostname_verifications`;
- `llm_*`, `audit_log`, `purge_log`.

The only write available to `aiontheballot_web` is calling `app.submit_report()`.

## 6. Enforcement map

| Rule (ADR-0002 / BRIEF)                                                                | Mechanism                                                                                    | Where                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Tenant id never changes                                                                | `BEFORE UPDATE` trigger                                                                      | Every tenant-owned table                                                |
| No cross-tenant references                                                             | Composite foreign keys                                                                       | Every child table                                                       |
| Exactly one operator                                                                   | Partial unique index, plus a deferred check when a tenant becomes active                     | `tenant_organizations`, `tenants`                                       |
| Only platform admins change the operator, the methodology kind or `is_pauseai_chapter` | Trigger, plus an audit row                                                                   | `tenant_organizations`, `methodologies`, `organizations`                |
| A demands methodology names its owner                                                  | `CHECK`                                                                                      | `methodologies`                                                         |
| Restricted assets only for eligible tenants                                            | Trigger on selection, with re-check when grants or the operator change                       | `tenant_brand_selections`, `brand_asset_grants`, `tenant_organizations` |
| Hostname rules                                                                         | Checks, partial index, no-delete trigger, platform-host rejection                            | `tenant_hostnames`                                                      |
| Ratings must be valid for the kind                                                     | Trigger                                                                                      | `assessments`, `assessment_revisions`, `llm_suggestions`                |
| Verbatim match                                                                         | Trigger computes `match_status` against `source_texts.normalized`                            | `draft_evidence`                                                        |
| Only admissible source kinds                                                           | Trigger checks `methodologies.admissible_source_kinds`                                       | `draft_evidence`, `revision_evidence`                                   |
| The evidence requirement                                                               | Deferred constraint trigger on revision insert                                               | `assessment_revisions`                                                  |
| Four-eyes; publisher identity                                                          | Trigger: `reviewer_id = current_user_id()` and not among contributors; role check            | `revision_internal`                                                     |
| Legal state transitions                                                                | Trigger                                                                                      | `assessments`, `elections`, `change_requests`, `reports`                |
| Published data is immutable                                                            | `UPDATE`, `DELETE` and `TRUNCATE` triggers, honouring only `app.purge`                       | `assessment_revisions`, `revision_*`, `audit_log`, `purge_log`          |
| Live-election structural edits need an approved change request                         | Trigger allows them only while `app.applying_change_request` is set by the approval function | `criteria`, `parties`, `methodologies`                                  |
| Publishing freeze                                                                      | Trigger                                                                                      | `assessment_revisions`                                                  |
| Archived elections are read-only                                                       | Trigger                                                                                      | Every election-scoped table                                             |
| Default-locale text is present when public                                             | Trigger on publish and on going live                                                         | `assessment_revisions`, `elections`                                     |
| Report cap and status                                                                  | `submit_report()`, using the daily counts                                                    | `reports`, `report_daily_counts`                                        |

Each row has a matching test, either in the data-rule list or in the matrix (ADR-0002).

## 7. Indexes

- Every foreign key column, and `(tenant_id, …)` leading composites.
- `assessment_revisions (assessment_id, revision_no desc)` for `current_revisions`.
- `source_texts` gets no trigram or full-text index yet. Matching is a substring search over one document's few
  hundred pages; add an index only if profiling says so.

## 8. Jobs (pg-boss)

- The migration Job creates the `pgboss` schema as owner, using pg-boss's construction SQL. Runtime roles never
  need `CREATE`.
- Only the API enqueues jobs, always inside `withActor`. Every payload carries `tenant_id` and `requested_by`.
- The worker runs as its own role, `aiontheballot_worker`. It sets the job's `tenant_id` as transaction context, and can
  only touch what jobs need: `source_texts`, `source_documents.extraction_status`, `llm_runs` and
  `llm_suggestions`.

## 9. Open items

1. ~~**Worker database role.**~~ **Decided:** a third halyard extra role, `aiontheballot_worker`. Its grants are limited
   to job tables, with RLS scoped by `app.tenant_id` from the job payload. It is a runtime role like the others:
   it owns nothing and has no `BYPASSRLS` (ADR-0002 §2).
2. **Better Auth tables.** They should sit in the `auth` schema with uuid ids (its `generateId` configured), if its
   Postgres adapter supports a non-default schema cleanly. The spike will confirm. Otherwise the fallback is
   prefixed tables in a schema `aiontheballot_web` can't read.
3. **The descriptive scale** (PLAN P6): define `red` versus `not_mentioned`.
4. **Admissible sources** (PLAN Q9): the default is `{pdf, web_page}` until the chapter decides.
5. **Party names localized?** They're assumed to be `jsonb`, because some coalitions use different names in
   co-official languages. If the chapter says names are always one string, they become `text`.
6. **Report retention** (PLAN Q7) sets `delete_after`. A daily job deletes expired reports and logs only their
   count.
