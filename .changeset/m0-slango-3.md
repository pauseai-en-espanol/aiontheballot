---
'@aiontheballot/api': patch
'@aiontheballot/admin': patch
'@aiontheballot/db': patch
'@aiontheballot/domain': patch
'@aiontheballot/i18n': patch
'@aiontheballot/ui': patch
'@aiontheballot/web': patch
---

Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
and the i18n JSON include they required, and write the Vitest configs in TypeScript.
