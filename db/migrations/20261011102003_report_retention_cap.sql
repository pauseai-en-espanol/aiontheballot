-- migrate:up

-- How long a tenant keeps reports before anonymizing them (PLAN Q7, R100) had no upper bound: a value past the date
-- range would make submit_report's day of anonymization overflow, and every report the public sends would fail. A
-- century at most, the limit the admin already gives (PLAN R102): the column takes whole days from 1 to 36,500. Adding
-- the check validates every tenant's value first, so the migration fails, changing nothing, if one is already larger.

ALTER TABLE app.tenants
  ADD CONSTRAINT tenants_report_retention_days_max CHECK (report_retention_days <= 36500);

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
