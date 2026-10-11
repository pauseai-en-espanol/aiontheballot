-- migrate:up

-- Slugs are path segments of the public site and of every share image's address, and the admin's forms now let
-- editors write them (PLAN R78, R101). The domain had no length limit: a long one makes a poor address, and one long
-- enough would pass the check and then fail in a unique index (whose entries are limited to about 2,700 bytes) as a
-- fault rather than a refusal. 63 characters, a DNS label's length and what the API's routes already accept for a
-- tenant's slug. Tenant, election, party and criterion slugs, and core criteria's keys, all use the domain. ALTER
-- DOMAIN checks every stored value first, so the migration fails, changing nothing, if one is already longer.

ALTER DOMAIN app.slug ADD CONSTRAINT slug_length CHECK (char_length(VALUE) <= 63);

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
