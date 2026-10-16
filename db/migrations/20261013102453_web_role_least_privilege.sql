-- migrate:up

-- The public role keeps only what the public API reads (PLAN D17c, from an RLS review; ADR-0002 §2, §7). None of these
-- reached another tenant's data; each was more than the public site needs:
--
-- - `tenant_documents.created_by`, who wrote a published policy text: the public reads a document's kind, version,
--   body and publish date, so a column grant of those (and the row's id and tenant) replaces the table grant.
-- - `hostname_tombstones`: a purge tombstones every hostname of the tenant, including ones never verified or made
--   public, and the public API never reads the table (routing reads `tenant_hostnames`). Its public policy goes with
--   the grant; platform admins still read it, and the hostname trigger still checks it as the writer.
-- - USAGE on `private`: the web role executes nothing there, its policies and the views it reads call nothing there,
--   and app's four functions it may call are SECURITY DEFINER, so they run as their owner.
--
-- Revokes only: no new grant beyond the narrower column grant, no definer.

REVOKE SELECT ON app.tenant_documents FROM aiontheballot_web;
GRANT SELECT (id, tenant_id, kind, version, body, published_at) ON app.tenant_documents TO aiontheballot_web;

REVOKE SELECT ON app.hostname_tombstones FROM aiontheballot_web;
DROP POLICY public_read ON app.hostname_tombstones;

REVOKE USAGE ON SCHEMA private FROM aiontheballot_web;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
