# CLAUDE.md

A multi-tenant platform that publishes sourced comparisons of political parties' positions on frontier-AI risk.

- Scope and constraints: `docs/BRIEF.md` (source of truth)
- Decisions: `docs/adr/` (0001 hosting, 0002 tenancy and authorization, 0003 application stack)
- Milestones, cut list and open decisions: `docs/PLAN.md` · Specs (data model, workflows, pages): `docs/spec/`

## Non-negotiables

- **Never invent political content:** no party positions, quotes, criteria wording or election facts. Seeds and
  fixtures must be obviously fictional ("Partido Ejemplo A"). Real content comes from editors.
- **No hardcoded names, domains or dates.** Product names and domains come from config; election dates from data.
- **The Host header selects public content only; it never grants access.** The public app has no sessions or
  cookies.
- **Tenant isolation lives in Postgres (ADR-0002).** Every new table needs `tenant_id`, RLS, composite FKs, the
  immutability trigger, explicit grants and an entry in `packages/db/tests/rls/matrix.ts` (checklist in CONTRIBUTING.md).
- **Database roles:** runtime roles never own anything, every admin query goes through `withActor`, and
  `aiontheballot_web` never gets write grants. A new `SECURITY DEFINER` function or grant requires an ADR-0002 update.
- **Data rules are database triggers:** evidence, four-eyes review, verbatim match, immutability. UI checks are
  for user experience only.
- **Accessibility:** ratings are never shown by colour alone (icon + text + colour). Target WCAG 2.2 AA.
- **Git:** no commit, push or branch operations without explicit permission.

## Layout

- `apps/web`: public Next.js site (no DB access, no sessions) · `apps/admin`: admin Next.js UI
- `apps/api`: Fastify API and worker; the only code that touches Postgres (via `packages/db`)
- `packages/db`: Kysely, generated types, `withActor` · `packages/domain`: pure shared logic
- `packages/ui`: Panda preset, Ark UI components, fixed rating visuals · `packages/og`: share-image templates
- `packages/observability`: Sentry privacy options (no personal data leaves the apps) and the browser error relay
- `db/migrations/*.sql` (dbmate) and `db/schema.sql` (generated dump, review it in every PR)

## Commands

Copy `.env.example` to `.env` for local database URLs.

| Command                                                     | What it does                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm install` · `pnpm dev` · `pnpm build`                  | Install, run locally, build                                               |
| `pnpm lint` · `pnpm format`                                 | oxlint (type-aware) · Prettier                                            |
| `pnpm build:check`                                          | Type check                                                                |
| `pnpm test`                                                 | Unit tests (Vitest)                                                       |
| `pnpm test:db`                                              | RLS matrix, catalog meta-tests and data rules (needs a local Postgres 18) |
| `pnpm test:e2e`                                             | Playwright, against a production build                                    |
| `pnpm db:up` · `pnpm db:down`                               | Start or stop local Postgres 18 (Docker, roles as in production)          |
| `pnpm db:migrate` · `pnpm db:new <name>` · `pnpm db:status` | Apply migrations (refreshes `db/schema.sql`) · new migration · status     |
| `pnpm db:seed`                                              | Load the fictional seeds (refuses any database not on this machine)       |
| `pnpm release:note`                                         | Add a changeset (pre-push and CI require one)                             |

## Conventions

- **TypeScript:** version 7, strict, via `@slango.configs/*`. ESM. No `any`.
- **Dependencies:** latest stable only (no alpha, beta, rc or canary), checked on npm when added.
- **Migrations:** SQL only, forward-only (never edit one once merged), one concern each.
- **Tests:** next to the code as `*.spec.ts`. Every new invariant or policy gets its test first.
- **i18n:** UI strings via `packages/i18n` (next-intl): English source, Spanish mandatory. Content is localized jsonb.
- **Deployment (ADR-0001):** Helm chart in `helm-charts/aiontheballot`, deployed by Argo CD on the `danilupion-com`
  cluster. Never tag images `:latest`. Every pod sets resource requests and limits and a securityContext.
- **Docs:** Markdown lines under 120 characters. Any change to the stack, tenancy or security model needs a new
  ADR (copy `docs/adr/0000-template.md`).
- **Milestones:** each one ends with green CI and a short demo note in `docs/PLAN.md`.
