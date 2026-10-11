---
'@aiontheballot/web': minor
'@aiontheballot/observability': patch
'@aiontheballot/e2e': patch
---

The public site loads each tenant's Plausible script from its own host and relays the script's events
(`/_relay/views.js`, `/_relay/views`; PLAN R83): every Plausible feature, no request to another host, no cookie. It
counts nothing until the deployment sets `PLAUSIBLE_URL` and `PLAUSIBLE_SITES`.
