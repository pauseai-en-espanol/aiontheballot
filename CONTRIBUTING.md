# Contributing

Thanks for helping. Please read [CLAUDE.md](CLAUDE.md) for the non-negotiables. This file covers the workflow and
the checklists.

## Workflow

1. Use Node from `.nvmrc` and pnpm 12, then run `pnpm install`.
2. Before committing, all of these must pass:

   ```sh
   pnpm lint          # oxlint (type-aware) + markdownlint
   pnpm test
   pnpm build:check
   ```

   For changes to the apps, also run `pnpm test:e2e` (Playwright, against production builds). Install its browser
   once with `pnpm --filter @aiontheballot/e2e exec playwright install chromium`.

3. Add a changeset for any change that affects a package (`pnpm release:note`). Use `pnpm release:empty` for docs or
   CI-only changes. The pre-push hook checks for one.
4. Keep PRs focused on one topic, and include what you ran and what it showed.

## Content rules

- **Never invent political content:** no party positions, quotes, criteria wording or election facts. Real content
  is entered by editors through the admin. Never commit it to the repository.
- **Fixtures and seeds must be obviously fictional,** e.g. "Partido Ejemplo A" or "Criterio de ejemplo 3".
- Real programme PDFs used for local testing stay outside the repository.

## Database rules

- Migrations are plain SQL in `db/migrations/`, run by dbmate. They are **forward-only**: never edit a migration
  that has been merged, and keep one concern per migration.
- Migrations run before the new pods roll out, so the old code runs against the new schema for a while. Make each one
  **expand/contract**: add what the new code needs, and drop or rename what the old code uses only in a later release,
  once nothing deployed reads it.
- After every migration, regenerate `db/schema.sql` and the Kysely types, and commit both. Review the
  `db/schema.sql` diff; it shows exactly how policies and grants changed.
- Only `apps/api` (API and worker) talks to Postgres, through `packages/db`. Admin queries go through `withActor`.

### New table checklist

Every new table in `app` needs all of these, or CI fails (see [ADR-0002](docs/adr/0002-tenancy-and-authorization.md)
and the [data model spec](docs/spec/data-model.md)):

1. **Classify it** as public-capable or private. A table is never both: private columns go in their own table.
2. **Tenant ownership:** `tenant_id uuid not null`, `unique (tenant_id, id)`, and composite foreign keys
   `(tenant_id, parent_id)` to every tenant-scoped parent.
3. **The tenant-immutability trigger,** and a `private.stamp(...)` trigger for its actor columns and event
   timestamps. Localized text, slugs and locale codes use the domains `app.localized`, `app.slug` and `app.locale`.
4. **RLS enabled, with policies:**
   - the public-visibility rule, if the table is public-capable;
   - membership policies through the `private` helpers, which already require `aal2`.
5. **Explicit grants** for each runtime role (`aiontheballot_web`, `aiontheballot_admin`, `aiontheballot_worker`),
   and nothing to `PUBLIC`.
6. **If it holds published history:** `UPDATE`/`DELETE`/`TRUNCATE` triggers using `private.forbid_mutation()`,
   which honours `app.purge` only for the table owner.
7. **Personal data?** Define its retention, and keep it out of `audit_log`.
8. **An entry in `packages/db/tests/rls/matrix.ts`** with the expected outcome for every principal and operation, plus
   data-rule tests for any new trigger.
9. **Docs:** update the data model spec, and regenerate `db/schema.sql` and the Kysely types.

New `SECURITY DEFINER` functions, or new grants to a runtime role, also require updating ADR-0002.

## Licence

By contributing, you agree that your code is licensed under [AGPL-3.0-or-later](LICENSE), and that content you
write (methodology, summaries) is licensed under [CC BY 4.0](LICENSE-CONTENT).
