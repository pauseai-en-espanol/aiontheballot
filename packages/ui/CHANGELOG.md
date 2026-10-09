# @aiontheballot/ui

## 0.1.0

### Minor Changes

- 85ada24: Add the shared Panda preset (@aiontheballot/ui) and the public and admin Next.js skeletons: a translated placeholder page,
  an unlogged /healthz, zoom left enabled, and no cookies or X-Powered-By on the public app. Add the "coming soon"
  message. Build packages without composite/incremental output so a JSON-only change can never leave stale
  declarations.

### Patch Changes

- e13c986: Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
  and the i18n JSON include they required, and write the Vitest configs in TypeScript.
- ff9135a: Build the UI package on install, so the web and admin Panda codegen can load its preset on a clean checkout. CI's first
  run failed at `pnpm install` because `dist/` did not exist yet.
