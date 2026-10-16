-- The export of one site's data (data model §3; runbook docs/runbooks/exporting-a-site.md; PLAN R160), as JSON Lines:
-- a header, then one line per table with every row of the site (its id), then a footer saying how many lines came
-- before it, so a file cut short shows. Run by the operator as the database's superuser, in the Postgres pod, in one
-- read-only, repeatable-read transaction (one consistent snapshot; it writes nothing), with the operator's settings
-- loaded from .env (docs/runbooks/README.md, conventions):
--
--   kubectl --context "$KUBE_CONTEXT" -n "$DATABASE_NAMESPACE" exec -i "$DATABASE_POD" -c postgres -- \
--     sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -U postgres -d aiontheballot -v slug=<short name>' \
--     < scripts/export-tenant.sql > <short name>.jsonl
--
-- Every table of `app` with a tenant_id is listed below; a database test fails when one isn't (as purge_tenant's own
-- check does), so a table added later can't be left out silently. Rows go out whole, personal data included (reports,
-- signups, invitations: the site's operator is their controller), but no token's hash, not even in the audit log's
-- diffs. Besides its own rows: the
-- tenant's row, the organizations it links, the brand assets it selects or was granted and the core criteria its
-- criteria map to (their rows, which other sites share), and its members' names and emails from Better Auth's tables
-- (never a password, factor or session). The files' bytes come from the API's volume (the runbook). Each table is one
-- JSON value, which Postgres caps at 1 GB: far beyond a site's size today, but the audit log and source texts grow.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT set_config('export.slug', :'slug', true) \g /dev/null
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.tenants t WHERE t.slug = current_setting('export.slug')) THEN
    RAISE EXCEPTION 'no site has the short name %', current_setting('export.slug');
  END IF;
END
$$;

-- export:begin
WITH site AS (SELECT t.id FROM app.tenants t WHERE t.slug = current_setting('export.slug')),
lines AS (
  SELECT 1 AS ord, json_build_object(
    'export', 'site', 'format', 1, 'slug', current_setting('export.slug'), 'tenantId', (SELECT id FROM site),
    'at', now(), 'database', current_database())::text AS line
  UNION ALL
  SELECT 2, json_build_object('table', 'app.tenants', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x)), '[]') FROM app.tenants x WHERE x.id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 3, json_build_object('table', 'app.assessment_contributors', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.assessment_contributors x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 4, json_build_object('table', 'app.assessment_revisions', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.assessment_revisions x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 5, json_build_object('table', 'app.assessments', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.assessments x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 6, json_build_object('table', 'app.audit_log', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) #- '{diff,old,token_hash}' #- '{diff,new,token_hash}' ORDER BY x.id), '[]') FROM app.audit_log x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 7, json_build_object('table', 'app.brand_asset_grants', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.brand_asset_grants x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 8, json_build_object('table', 'app.change_requests', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.change_requests x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 9, json_build_object('table', 'app.criteria', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.criteria x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 10, json_build_object('table', 'app.draft_checked_documents', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.draft_checked_documents x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 11, json_build_object('table', 'app.draft_evidence', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.draft_evidence x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 12, json_build_object('table', 'app.elections', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.elections x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 13, json_build_object('table', 'app.files', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.files x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 14, json_build_object('table', 'app.invitations', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.invitations x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 15, json_build_object('table', 'app.job_requests', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.job_requests x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 16, json_build_object('table', 'app.llm_runs', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.llm_runs x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 17, json_build_object('table', 'app.llm_suggestions', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.llm_suggestions x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 18, json_build_object('table', 'app.memberships', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.memberships x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 19, json_build_object('table', 'app.methodologies', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.methodologies x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 20, json_build_object('table', 'app.methodology_reviewers', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.methodology_reviewers x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 21, json_build_object('table', 'app.parties', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.parties x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 22, json_build_object('table', 'app.public_versions', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.public_versions x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 23, json_build_object('table', 'app.report_daily_counts', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.report_daily_counts x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 24, json_build_object('table', 'app.reports', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.reports x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 25, json_build_object('table', 'app.review_events', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.review_events x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 26, json_build_object('table', 'app.revision_checked_documents', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.revision_checked_documents x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 27, json_build_object('table', 'app.revision_evidence', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.revision_evidence x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 28, json_build_object('table', 'app.revision_internal', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.revision_internal x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 29, json_build_object('table', 'app.signup_daily_counts', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.signup_daily_counts x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 30, json_build_object('table', 'app.signups', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.signups x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 31, json_build_object('table', 'app.source_documents', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.source_documents x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 32, json_build_object('table', 'app.source_texts', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.source_texts x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 33, json_build_object('table', 'app.structural_changes', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.structural_changes x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 34, json_build_object('table', 'app.tenant_brand_selections', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.tenant_brand_selections x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 35, json_build_object('table', 'app.tenant_documents', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.tenant_documents x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 36, json_build_object('table', 'app.tenant_hostnames', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.tenant_hostnames x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 37, json_build_object('table', 'app.tenant_organizations', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) - '{token_hash}'::text[] ORDER BY to_jsonb(x)::text), '[]') FROM app.tenant_organizations x WHERE x.tenant_id = (SELECT id FROM site)))::text
  UNION ALL
  SELECT 38, json_build_object('table', 'app.organizations', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) ORDER BY x.id), '[]') FROM app.organizations x
      WHERE x.id IN (SELECT o.organization_id FROM app.tenant_organizations o WHERE o.tenant_id = (SELECT id FROM site))))::text
  UNION ALL
  SELECT 39, json_build_object('table', 'app.brand_assets', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) ORDER BY x.id), '[]') FROM app.brand_assets x
      WHERE x.id IN (SELECT s.brand_asset_id FROM app.tenant_brand_selections s WHERE s.tenant_id = (SELECT id FROM site))
         OR x.id IN (SELECT g.brand_asset_id FROM app.brand_asset_grants g WHERE g.tenant_id = (SELECT id FROM site))))::text
  UNION ALL
  SELECT 40, json_build_object('table', 'app.core_criteria', 'rows',
    (SELECT coalesce(json_agg(to_jsonb(x) ORDER BY x.id), '[]') FROM app.core_criteria x
      WHERE x.id IN (SELECT c.core_criterion_id FROM app.criteria c WHERE c.tenant_id = (SELECT id FROM site))))::text
  UNION ALL
  SELECT 41, json_build_object('table', 'auth.users', 'rows',
    (SELECT coalesce(json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email) ORDER BY u.id), '[]')
       FROM auth.users u
      WHERE u.id IN (SELECT m.user_id FROM app.memberships m WHERE m.tenant_id = (SELECT id FROM site))))::text
)
SELECT line FROM (
  SELECT ord, line FROM lines
  UNION ALL
  SELECT 1000000, json_build_object('end', true, 'lines', (SELECT count(*) FROM lines))::text
) numbered
ORDER BY ord;
-- export:end

COMMIT;
