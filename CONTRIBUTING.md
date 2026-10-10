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
   once with `pnpm --filter @aiontheballot/e2e exec playwright install chromium`. It needs the local database,
   migrated and seeded (`pnpm db:up && pnpm db:migrate && pnpm db:seed`), and `WEB_DATABASE_URL` in `.env`.
   The seeds' file bytes go to `.data/files` (or `FILES_ROOT`, see `.env.example`); `pnpm db:seed` writes them again
   on every run.

   **Refreshing an already-seeded local database.** The seeds add nothing to a database they already seeded, so after
   a change to them, or when a migration can't apply to data they wrote earlier (`files_on_volume`, for instance,
   refuses to drop stored bytes), start again from an empty database. This deletes only local, fictional data:

   ```sh
   docker compose down -v   # stop Postgres and delete its volume
   rm -rf .data/files       # the old seeds' bytes
   pnpm db:up && pnpm db:migrate && pnpm db:seed
   ```

   The test database (`aiontheballot_test`) needs nothing: `pnpm test:db` rebuilds it on every run. The roles,
   though, are created only with a new volume (`db/local/init.sh`). When a new runtime role is added there, start
   again as above, or add it to the running database, as for `aiontheballot_auth`:

   ```sh
   docker exec -i aiontheballot-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres' <<'SQL'
   CREATE ROLE aiontheballot_auth WITH LOGIN PASSWORD 'dev-only-auth'
     NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   GRANT CONNECT ON DATABASE aiontheballot, aiontheballot_test TO aiontheballot_auth;
   SQL
   ```

3. Add a changeset for any change that affects a package (`pnpm release:note`). Use `pnpm release:empty` for docs or
   CI-only changes. The pre-push hook checks for one, and it and CI check that every deployable whose code changed is
   released: a migration needs `@aiontheballot/migrations` in the changeset, or its image isn't rebuilt. A change to
   the UI preset needs web and admin too (they take it as a devDependency), and one to root files (the lockfile,
   `turbo.json`) needs every deployable.
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
3. **The tenant-immutability trigger,** a `private.stamp(...)` trigger for its actor columns and event
   timestamps, and the `private.audit()` trigger (or an entry in the catalog test's `NOT_AUDITED`, with a
   reason). Localized text, slugs and locale codes use the domains `app.localized`, `app.slug` and `app.locale`.
4. **RLS enabled, with policies:**
   - the public-visibility rule, if the table is public-capable, for `aiontheballot_web` only (the admin role sees
     only what memberships give it), plus the `private.bump_public_version()` trigger, so the public cache follows;
   - membership policies through the `private` helpers, which already require `aal2`.
5. **Explicit grants** for each runtime role (`aiontheballot_web`, `aiontheballot_admin`, `aiontheballot_worker`),
   and nothing to `PUBLIC`. `aiontheballot_auth` gets nothing outside the `auth` schema (ADR-0002 §2).
6. **If it holds published history:** `UPDATE`/`DELETE`/`TRUNCATE` triggers using `private.forbid_mutation()`,
   which honours `app.purge` only for the table owner.
7. **Personal data?** Define its retention, and comment each such column `personal data`: the audit trigger never
   copies those into `audit_log`, and the catalog test's `PERSONAL_DATA` list must name them.
8. **An entry in `packages/db/tests/rls/matrix.ts`** with the expected outcome for every principal and operation, plus
   data-rule tests for any new trigger.
9. **Docs:** update the data model spec, and regenerate `db/schema.sql` and the Kysely types.

New `SECURITY DEFINER` functions, or new grants to a runtime role, also require updating ADR-0002.

## Licence

By contributing, you agree that your code is licensed under [AGPL-3.0-or-later](LICENSE), and that content you
write (methodology, summaries) is licensed under [CC BY 4.0](LICENSE-CONTENT).
