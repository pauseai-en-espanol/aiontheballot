-- migrate:up

-- An operator's newsletter (PLAN R50): the coming-soon page offers it to people who want to hear when the site is
-- published. Public, like every organization column; only platform admins write it, like the rest of the row. The
-- link is the operator's own: the platform never collects an email address.
ALTER TABLE app.organizations
  ADD COLUMN newsletter_url text CHECK (newsletter_url ~ '^https://');

GRANT INSERT (newsletter_url), UPDATE (newsletter_url) ON app.organizations TO aiontheballot_admin;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
