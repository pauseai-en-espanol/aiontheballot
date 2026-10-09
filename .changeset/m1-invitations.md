---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add invitations: `app.invitations`, visible only to country admins and platform admins, storing only the token's
SHA-256, expiring within 30 days, and changing once (revoked, or accepted before expiry, with time and acceptor from
the session). Non-pending invitations can be deleted, so emails aren't kept longer than needed. The matrix supports
per-row rules for row states.
