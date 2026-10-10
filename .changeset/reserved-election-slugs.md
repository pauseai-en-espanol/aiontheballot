---
'@aiontheballot/migrations': minor
'@aiontheballot/domain': minor
'@aiontheballot/db': patch
'@aiontheballot/web': patch
'@aiontheballot/api': patch
---

An election's slug can never be `brand`, `og` or `healthz`, paths the public site serves itself (migration
`reserved_election_slugs`; `RESERVED_ELECTION_SLUGS` in `packages/domain`).
