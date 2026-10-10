-- migrate:up

-- An election's pages live at /{slug} (ADR-0003 §6), so its slug can never be a first path segment the public site
-- serves itself on a tenant's address (PLAN R59, R76): brand images and site icons (/brand/…), share images (/og/…)
-- and the health probe (/healthz, answered on every host before routing). Paths with a dot (/favicon.ico,
-- /manifest.webmanifest) can't be slugs anyway. packages/domain's RESERVED_ELECTION_SLUGS is the same list, and a web
-- test checks every route against it.

ALTER TABLE app.elections
  ADD CONSTRAINT elections_slug_not_reserved CHECK (slug NOT IN ('brand', 'healthz', 'og'));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
