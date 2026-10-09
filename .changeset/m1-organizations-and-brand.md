---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add organizations and brand assets: `organizations`, `tenant_organizations` (one operator per tenant), `brand_assets`
(PNG, JPEG or WebP up to 2 MB, hash checked), `brand_asset_grants` and `tenant_brand_selections`. Platform admins write
organizations, links, assets and grants; country admins choose their tenant's selections. Writes to a shared
organization or asset bump every tenant that shows it, and the audit log no longer copies binary columns.
