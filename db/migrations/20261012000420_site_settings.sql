-- migrate:up

-- A site's public settings, which lived in the web app's environment (gitops) and now are data (PLAN R135, decided by
-- Dani; ADR-0002 §6 amended): whether the site is open or still coming soon (was OPEN_SITES), whether search engines
-- may index it (a demo's fictional content may not), and its Plausible script (was PLAUSIBLE_SITES, keyed by host:
-- now counted on the site's canonical host). Platform admins set them on the site's page: members_may_change keeps
-- every column it doesn't list a platform admin's. The public site reads them through aiontheballot_web, for active
-- sites only (public_read), with the routing data.

ALTER TABLE app.tenants
  ADD COLUMN site_open boolean NOT NULL DEFAULT false,
  ADD COLUMN search_indexing boolean NOT NULL DEFAULT true,
  ADD COLUMN plausible_script text
    CONSTRAINT tenants_plausible_script_check CHECK (plausible_script ~ '^pa-[A-Za-z0-9_-]{1,100}\.js$');

GRANT UPDATE (site_open, search_indexing, plausible_script) ON app.tenants TO aiontheballot_admin;
GRANT SELECT (site_open, search_indexing, plausible_script) ON app.tenants TO aiontheballot_web;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
