# @aiontheballot/domain

## 0.2.0

### Minor Changes

- 902015c: Add public-site routing (ADR-0002): `resolve()` picks the tenant from the Host header and serves, 301s to the
  canonical base or 404s, never falling back to a default tenant; `canonicalBase()`; and a routing table that re-checks
  the hostname invariants. It also parses the locale prefix and reserves `_` paths, so the internal prefix can't be
  requested.

## 0.1.0

### Minor Changes

- 9a83b4d: Add @aiontheballot/db (Kysely client, withActor, generated types) and the TypeScript quote normaliser in @aiontheballot/domain,
  kept identical to private.normalize_for_match() by parity tests against Postgres.
- 6e85ec0: Add the shared domain package (methodology kinds and their rating scales) and the i18n package (English source
  messages, mandatory Spanish checked against them, and a typed translator usable outside Next).

### Patch Changes

- e13c986: Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
  and the i18n JSON include they required, and write the Vitest configs in TypeScript.
- 85ada24: Add the shared Panda preset (@aiontheballot/ui) and the public and admin Next.js skeletons: a translated placeholder page,
  an unlogged /healthz, zoom left enabled, and no cookies or X-Powered-By on the public app. Add the "coming soon"
  message. Build packages without composite/incremental output so a JSON-only change can never leave stale
  declarations.
