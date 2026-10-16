-- migrate:up

-- The vocabulary of the data model (spec §2). Rating labels, icons and colours are not stored: they are the fixed
-- rating language in @aiontheballot/domain and @aiontheballot/i18n, which a test keeps in step with these values.

-- Closed by default for types too (ADR-0002 §6). USAGE on a type only lets a role create objects that depend on it;
-- runtime roles can still use these values in queries.
ALTER DEFAULT PRIVILEGES REVOKE USAGE ON TYPES FROM PUBLIC;

CREATE TYPE app.tenant_role AS ENUM ('country_admin', 'editor', 'reviewer');
CREATE TYPE app.org_role AS ENUM ('operator', 'endorser');
CREATE TYPE app.election_type AS ENUM ('general', 'european', 'regional', 'municipal', 'other');
CREATE TYPE app.election_status AS ENUM ('draft', 'live', 'archived');
CREATE TYPE app.methodology_kind AS ENUM ('demands', 'descriptive');

-- Which values are valid depends on the methodology kind: demands uses meets, partially_meets, does_not_meet and
-- not_mentioned; descriptive uses green, yellow, red and not_mentioned. A trigger enforces it where ratings are written.
CREATE TYPE app.rating AS ENUM (
  'meets', 'partially_meets', 'does_not_meet', 'green', 'yellow', 'red', 'not_mentioned'
);

CREATE TYPE app.assessment_state AS ENUM ('draft', 'in_review', 'published');
CREATE TYPE app.change_kind AS ENUM ('initial', 'update', 'correction', 'withdrawal');
CREATE TYPE app.source_kind AS ENUM ('pdf', 'web_page', 'social_post', 'video', 'audio', 'party_submission');
CREATE TYPE app.match_status AS ENUM ('unmatched', 'matched', 'attested');
CREATE TYPE app.extraction_status AS ENUM ('pending', 'done', 'failed', 'not_applicable');
CREATE TYPE app.programme_status AS ENUM ('pending', 'published');
CREATE TYPE app.file_bucket AS ENUM ('public_assets', 'sources');
CREATE TYPE app.review_event_kind AS ENUM ('submitted', 'recalled', 'approved', 'rejected', 'commented');
CREATE TYPE app.change_action AS ENUM ('update', 'add', 'retire');
CREATE TYPE app.change_request_state AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE app.report_kind AS ENUM ('error_report', 'party_response');
CREATE TYPE app.report_status AS ENUM ('new', 'triaged', 'accepted', 'rejected', 'spam');
CREATE TYPE app.suggestion_state AS ENUM ('open', 'accepted', 'rejected');
CREATE TYPE app.evidence_origin AS ENUM ('manual', 'llm', 'mcp');
CREATE TYPE app.job_kind AS ENUM ('fetch_source', 'extract_source', 'archive_source', 'llm_run');
CREATE TYPE app.tenant_document_kind AS ENUM ('privacy_policy', 'right_of_reply_policy', 'about_operator');

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
