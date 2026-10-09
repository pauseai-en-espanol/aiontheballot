# @aiontheballot/db

## 0.1.0

### Minor Changes

- 9a83b4d: Add @aiontheballot/db (Kysely client, withActor, generated types) and the TypeScript quote normaliser in @aiontheballot/domain,
  kept identical to private.normalize_for_match() by parity tests against Postgres.

### Patch Changes

- 300f450: Add the tenant-isolation matrix harness: principals from ADR-0002, a runner that refuses to pass on a missing target,
  a deny that changed data, or an allow touching more than one row, and a completeness test against the `app` schema.
- e13c986: Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
  and the i18n JSON include they required, and write the Vitest configs in TypeScript.
