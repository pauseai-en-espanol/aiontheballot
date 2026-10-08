# CLAUDE.md

A multi-tenant platform that publishes sourced comparisons of political parties' positions on frontier-AI risk.

- Scope and constraints: `docs/BRIEF.md` (source of truth)
- Decisions: `docs/adr/` (0001 hosting, 0002 tenancy and authorization, 0003 application stack, pending)
- Milestones, cut list and open decisions: `docs/PLAN.md`

## Non-negotiables

- **Never invent political content:** no party positions, quotes, criteria wording or election facts. Seeds and
  fixtures must be obviously fictional ("Partido Ejemplo A"). Real content comes from editors.
- **No hardcoded names, domains or dates.** Product names and domains come from config; election dates from data.
- **The Host header selects public content only; it never grants access.** The public app has no sessions or
  cookies.
- **Tenant isolation lives in Postgres (ADR-0002).** Every new table needs `tenant_id`, RLS, composite FKs, the
  immutability trigger, explicit grants and an entry in `db/tests/rls/matrix.ts` (checklist in CONTRIBUTING.md).
- **Database roles:** runtime roles never own anything, every admin query goes through `withActor`, and
  `ballot_web` never gets write grants. A new `SECURITY DEFINER` function or grant requires an ADR-0002 update.
- **Data rules are database triggers:** evidence, four-eyes review, verbatim match, immutability. UI checks are
  for user experience only.
- **Accessibility:** ratings are never shown by colour alone (icon + text + colour). Target WCAG 2.2 AA.
- **Git:** no commit, push or branch operations without explicit permission.

## Commands

These become available once the M0 skeleton lands.

| Command | What it does |
|---|---|
| `pnpm install` · `pnpm dev` · `pnpm build` | Install, run locally, build |
| `pnpm lint` · `pnpm format` | oxlint (type-aware) · Prettier |
| `pnpm build:check` | Type check |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:db` | RLS matrix, catalog meta-tests and data rules (needs a local Postgres 18) |
| `pnpm test:e2e` | Playwright, against a production build |
| `pnpm db:migrate` · `pnpm db:new <name>` | Run migrations · create a new one |
| `pnpm db:seed` | Load fictional seed data (refuses to run against production) |
| `pnpm release:note` | Add a changeset (pre-push and CI require one) |

## Conventions

- **TypeScript:** version 7, strict, via `@slango.configs/*`. ESM. No `any`.
- **Migrations:** SQL only, forward-only (never edit one once merged), one concern each.
- **Tests:** next to the code as `*.spec.ts`. Every new invariant or policy gets its test first.
- **i18n:** UI strings go through the i18n package (Spanish first). Content fields are localized jsonb.
- **Deployment (ADR-0001):** Helm chart in `helm-charts/ballot`, deployed by Argo CD on the `danilupion-com`
  cluster. Never tag images `:latest`. Every pod sets resource requests and limits and a securityContext.
- **Docs:** Markdown lines under 120 characters. Any change to the stack, tenancy or security model needs a new
  ADR (copy `docs/adr/0000-template.md`).
- **Milestones:** each one ends with green CI and a short demo note in `docs/PLAN.md`.
