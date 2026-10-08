---
'@ballot/api': patch
'@ballot/admin': patch
'@ballot/db': patch
'@ballot/domain': patch
'@ballot/i18n': patch
'@ballot/ui': patch
'@ballot/web': patch
---

Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
and the i18n JSON include they required, and write the Vitest configs in TypeScript.
