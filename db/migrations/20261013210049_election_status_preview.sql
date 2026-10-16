-- migrate:up

-- An election's stage between draft and live (PLAN R181): in preview, its site's members see it through the admin's
-- preview as the public will, and edit it as a draft; the public sees none of it. A value of its own, in its own
-- migration: Postgres lets no statement use a new enum value in the transaction that adds it, and
-- election_curtains, which comes next, gives it its rules.

ALTER TYPE app.election_status ADD VALUE 'preview' BEFORE 'live';

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
