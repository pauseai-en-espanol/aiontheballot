---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
'@aiontheballot/domain': minor
'@aiontheballot/i18n': minor
'@aiontheballot/og': minor
'@aiontheballot/api': minor
'@aiontheballot/web': minor
'@aiontheballot/e2e': minor
---

Tenants' own logos (migration `tenant_brand_uploads`): a brand selection can name one of the tenant's uploaded
images, public while an active tenant selects it. The API serves the home data's brand images by hash; the web app
shows the operator's logo in the coming-soon page's header and footer, at `/brand/{sha256}.{ext}` cached as immutable,
and draws it on the share cards.
