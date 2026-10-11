-- migrate:up

-- A site's own pages (public-site spec §3) take first path segments under its root, in each UI language's words: the
-- legal notice, the privacy policy, the page about the operator and the signup list's pages (`/aviso-legal`,
-- `/legal-notice`…). An election's pages live at /{slug}, so no election may take one of them as its slug (PLAN R76).
-- packages/domain's RESERVED_ELECTION_SLUGS is the same list; a database test refuses each of its entries here. The
-- check validates every existing slug, so the migration fails, changing nothing, if an election already has one.

ALTER TABLE app.elections
  DROP CONSTRAINT elections_slug_not_reserved,
  ADD CONSTRAINT elections_slug_not_reserved CHECK (slug NOT IN (
    'about', 'aviso-legal', 'avisos', 'brand', 'healthz', 'legal-notice', 'og', 'privacidad', 'privacy',
    'quienes-somos', 'updates'));

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
