# ADR-0003: Application stack

- **Status:** Accepted. Smaller choices still open are listed under [Still open](#still-open).
- **Date:** 2026-10-08
- **Relates to:** BRIEF §2, §5, §6, §8; [ADR-0001](0001-hosting-and-delivery.md),
  [ADR-0002](0002-tenancy-and-authorization.md)

## Context

What this ADR has to respect:

- TypeScript strict, using the `@slango.configs/*` packages, plus `@slango/*` packages where useful.
- The public site and the admin are separate from the outside: different hosts, and no sessions or cookies on
  public hosts.
- Postgres 18 is reached only through `withActor` (ADR-0002). SQL migrations are the source of truth.
- Server-side PNG share images in four sizes.
- i18n: UI strings in several languages, with `hreflang`. The brief says Spanish first, then Catalan, Basque and
  Galician; the owner changed the source language to English (see §6).
- WCAG 2.2 AA, and Playwright for end-to-end tests.
- Deployment: Helm chart plus HTTPRoute (ADR-0001).
- After a publish, the change must be visible on every replica within 60 seconds.

Work that request handlers can't absorb also has to live somewhere:

- PDF ingestion and text extraction;
- archive snapshots;
- LLM extraction runs;
- scheduled programme checks.

Future brief items will be further clients of the same data: the party questionnaire, tenant self-onboarding,
cross-country views and an open-data export.

## Decision

### 1. Two Next.js frontends, plus a Fastify API and worker that own all data access

**Deployables:**

| Deployable        | Framework                        | What it does                                                                                              | Database access                                                             |
| ----------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web`        | Next.js 16                       | Public site                                                                                               | **None**: no DB credentials, no sessions, no cookies                        |
| `apps/admin`      | Next.js 16                       | Editorial UI                                                                                              | None; calls the API, forwarding the user's cookie for server-side rendering |
| `apps/api`        | Fastify                          | **All** data access (admin and public routes), auth, report intake, future public and open-data endpoints | Yes                                                                         |
| `apps/api` worker | Same codebase, second entrypoint | Background jobs from a Postgres-backed queue (no Redis)                                                   | Yes                                                                         |

**Routing (HTTPRoute path split, as in gifcept):**

- On the admin host, `/api/*` goes to Fastify and `/` goes to `apps/admin`. Same origin means host-only cookies
  just work, with no CORS.
- On public hosts, only the public API routes go to Fastify, for example the report endpoint.

**Guardrails.** In this design the public site depends on the API, so:

1. **Jobs never run in the API process.** The worker is a separate Deployment, so PDF parsing, archiving and LLM
   runs can't starve the API.
2. **The API runs at least 2 replicas**, with resource requests and limits, like `apps/web`.
3. **The public web keeps serving its cache when the API errors.** Pages already rendered stay up; only pages
   nobody has visited yet, and new images, fail until the API recovers.
4. **Public routes in the API use the read-only `aiontheballot_web` pool.** Only admin routes get
   `aiontheballot_admin`, so a bug in a public route still can't write.

**Options considered:**

- **Next.js only, using server actions:** rejected. Background work and future clients need a real backend, and
  writes would come from two codebases.
- **Next.js plus NestJS:** rejected by the owner.
- **One Next.js app split by host:** rejected. Admin code would ship in the internet-facing runtime.
- **The public web reading Postgres directly:** rejected. That would make the public site independent of the API,
  but the owner preferred one data layer and no DB credentials in the internet-facing app.

### 2. Auth: Better Auth with password and mandatory TOTP

- Mounted in Fastify at `/api/auth/*` on the admin host.
- Sessions are stored in our Postgres and can be revoked. The two-factor plugin provides TOTP and backup codes,
  and rate limiting is built in.
- Sign-up is disabled. Accounts come only from our invitation flow (`app.invitations` creates the membership).
- A user who hasn't enrolled TOTP can only reach the enrolment page. The API sets `app.aal = '2'` only for sessions
  that completed TOTP, and the database enforces that (ADR-0002 §9).
- Better Auth's tables are generated as SQL and committed as ordinary dbmate migrations.

**Options considered:**

- **Passkeys as the main factor:** deferred. Passkeys are bound to the admin domain, so we can add them once the
  admin host is final.
- **Custom auth like gifcept's:** rejected. We'd own all the security-critical code.
- **External single sign-on:** not needed. The association doesn't run a central identity provider.

### 3. Data layer: SQL migrations with dbmate, typed queries with Kysely, no ORM

**Migrations:**

- Plain `.sql` files, run by dbmate.
- dbmate keeps `db/schema.sql`, a full dump of the resulting schema, so every PR shows how policies and grants
  changed.
- Migrations are forward-only.

**Queries:**

- Kysely, a typed query builder, with types generated from the migrated schema by kysely-codegen. A CI check
  catches drift between the two.
- **`withActor` is a Kysely transaction** that sets `app.user_id` and `app.aal` before anything else runs.

**Where the database code lives:**

- `packages/db` holds the Kysely factory, the generated types, `withActor` and the two connection pools.
- Only `apps/api` may import it. A lint rule enforces this.

**How the API is organised:**

- One Fastify plugin per domain area: elections, assessments, evidence, sources, reports and hostnames.
- Each data function takes a transaction (`trx`) as its first argument, so functions compose inside a single
  `withActor`, and the worker reuses them unchanged.

**Options considered:**

- **Prisma 7:** viable, but its schema language can't express RLS policies, triggers or grants. The
  security-critical half would live in hand-edited migrations outside its model.
- **Drizzle:** same split.
- **SQL plus raw `pg`:** hand-written row types drift from the schema.

### 4. Admin host: one central host, configurable

- The pilot uses one admin host, **`admin.iaenlasurnas.es`**. Admin hosts are configuration, not code.
- The **tenant context comes from the URL path** (`/t/{slug}/…`), never from the host.
- Adding a per-tenant admin host later, such as `admin.<tenant domain>` for that tenant's members, is a
  configuration plus DNS and TLS change.
- **Platform admins only ever use the central host.** A tenant controls its own domain's DNS and could otherwise
  capture platform-admin credentials there.
- Moving the central host later means everyone logs in again (and re-enrols passkeys, if those have been added
  by then).

### 5. Design system: Panda CSS plus Ark UI

**Package and components:**

- **Styling:** Panda CSS. The owner knows it, and gifcept uses it.
- **Components:** Ark UI, a set of headless, accessible components from the Chakra team. Chakra UI v3 is itself
  built on Ark.
- **Recipes:** Park UI's Panda recipes are **copied into `packages/ui` and owned by us**, so Park UI's pre-1.0
  status doesn't matter.
- **Shared preset:** `packages/ui` exports a Panda preset (tokens, semantic tokens, recipes) and the components,
  used by both `apps/web` and `apps/admin`.

**Rules:**

- **Fixed rating language.** Each rating in both methodology kinds is icon + text + colour, contrast-checked.
  Tenants can't override it (BRIEF §3 and §6).
- **Tenant theming at runtime.** Brand colours become CSS variables injected per tenant, behind semantic tokens.
  Tenant colours are contrast-checked when saved.
- **Share images.** Satori can't use Panda classes, so the share-image templates (`packages/og`) read the same
  token values from TypeScript.
- **Lean public site.** It is mostly server components. Ark is used only in its few interactive pieces (the
  card-view toggle and the image-download dialog). The admin uses Ark throughout: forms, combobox, date picker,
  file upload, dialogs, toasts.

**Options considered:**

- **React Aria Components:** the strongest accessibility and i18n, but completely unstyled, so every recipe would
  be ours. This was the close runner-up.
- **Base UI:** very popular, but it has no date picker or file upload, and its popular styles are Tailwind.
- **Hand-rolled components:** too much to rebuild for the admin.

**Accessibility safety net:** axe in CI, plus a manual keyboard and screen-reader pass in M5.

### 6. i18n: next-intl, English source, Spanish mandatory

- **English is the source language** for UI strings: `en.json` holds every key.
- **Spanish is mandatory from the first iteration.** `es.json` is typed against the shape of `en.json`, so a
  missing Spanish string fails `build:check`.
- Catalan, Basque and Galician are added later as optional locales that fall back to Spanish.
- **The library formats messages; it doesn't route.** Our `resolve()` parses the locale from the path, and
  next-intl's routing middleware is not used.
  - Paths look like `/generales-2026` in the tenant's default locale and `/ca/generales-2026` in others.
  - `hreflang` is generated from the locales each tenant enables.
- **The same messages are used outside Next.** The share-image templates and the API's emails use next-intl's core
  (`createTranslator`) through `packages/i18n`.
- **English UI is not the same as English content.** A tenant's default locale is a tenant setting; Spain defaults
  to Spanish. Content fields (party names, criteria, summaries) are localized jsonb, entered by editors. A locale
  is only enabled publicly for a tenant once its content is translated, so Spain doesn't expose `/en` yet.

**Options considered:**

- **Paraglide JS 2:** framework-agnostic typed functions with tree-shaking. But on a mostly server-rendered site
  its bundle advantage is small, and its Next adapter is deprecated, which means hand-wiring per-request locale.
- **Lingui:** relies on compiler macros, which are fragile across Next upgrades.

### 7. Errors and observability: GlitchTip now, OpenTelemetry from day one

- **Error tracking:** self-hosted **GlitchTip** (MIT), receiving errors through the standard Sentry SDKs:
  `@sentry/node` in the API and worker, `@sentry/nextjs` on both Next servers and in the admin's browser, and a
  minimal `@sentry/browser` client on the public site. **Errors only**: no tracing is enabled. Shared code lives in
  `packages/observability`.
  - It runs on the cluster as a **cluster-wide** service (gitops `catalog/o11y/glitchtip`), with its database on
    the shared Postgres instance. The UI is **VPN-only** (`gateway-private`).
  - **Server-side** SDKs send to its in-cluster Service. Each app has its own project, and its DSN is a sealed
    secret (`scripts/seal-glitchtip-dsns.sh`).
  - **Browser** SDKs send to `/_relay/errors` on the app's own host (Sentry `tunnel`), so nothing of GlitchTip
    faces the internet:
    - The relay is a route handler in each Next app, not in the API, which holds the database credentials.
    - It forwards only to its own app's project, with the DSN held server-side. The browser gets a placeholder
      DSN, so neither the key nor GlitchTip's host reaches the page.
    - It caps the body at 200 KB, forwards no client headers, sets no cookie and shares the per-IP rate limit. The
      CSP stays `'self'`.
  - **Public-site weight:** the full Next client SDK would add about 78 KB gzipped to every page. The public site
    instead installs two small listeners and loads a 20 KB client only on the first error, so a page that hits
    none downloads no SDK. It has no breadcrumbs. The admin loads the full SDK, with breadcrumbs.
  - **Personal data** never leaves the app:
    - Sentry 11 collects cookies, headers, bodies, query strings and local variables by default. Each category is
      switched off; the user agent is the only header kept.
    - `beforeSend` drops the user, strips query strings and fragments, and redacts email addresses everywhere.
    - Free text can't be recognised, so code must never put request bodies into errors, and tokens travel in query
      strings, never in paths.
  - **No `withSentryConfig`:** source maps aren't uploaded yet (GlitchTip is VPN-only), and its bundle trimming
    doesn't apply under Turbopack. Next's `compiler.define` sets `__SENTRY_TRACING__` and `__SENTRY_DEBUG__` to
    `false` instead.
  - Because the SDKs speak the Sentry protocol, switching backend later is a DSN change.
- **Observability:** the API, the worker and both Next apps are instrumented with OpenTelemetry from day one
  (traces, metrics, logs), independent of any backend.
  - Until a backend exists, OTLP export stays off and logs go to stdout.
  - A cluster-wide OTel backend (SigNoz, ClickStack or a Grafana stack) is a separate initiative in the gitops
    repo. Our apps start exporting to it when it's ready.
  - The current Sentry SDKs are themselves built on OpenTelemetry, so the two coexist.

**Options considered:**

- **Bugsink:** lighter (a single container), but under a custom licence and errors-only. A reasonable swap later,
  since it uses the same DSN.
- **Sentry SaaS Free:** one user, and data leaves our infrastructure.
- **Sentry self-hosted:** far too heavy for a shared single node, and FSL-licensed.
- **OTel-only now (no GlitchTip):** the most infrastructure work before launch, and weaker error triage for the
  admin UI.

### 8. Share images: satori plus resvg-js, behind a swappable renderer

**The four sizes (BRIEF §6):**

| Size      | Used for                              |
| --------- | ------------------------------------- |
| 1200×630  | The `og:image` link preview           |
| 1080×1080 | Square feed posts (download button)   |
| 1080×1350 | Portrait feed posts (download button) |
| 1080×1920 | Stories and status (download button)  |

**Rendering:**

- `packages/og` holds the fixed templates (BRIEF §3, invariant 4) and exposes `render(template, size) → PNG`.
- satori turns JSX into SVG; `@resvg/resvg-js` rasterises the SVG to PNG.
- Templates read token values from `packages/ui`, so the images look like the site. Fonts are self-hosted.
- `apps/web` serves the images from content-hash URLs with `immutable` caching, so each image is rendered once.
  An unknown or outdated hash redirects to the current one and never triggers a render.
- **Testability:** the invariant test renders every template to SVG and asserts that `canonicalBase` appears as
  text. No pixel comparison is needed.
- **Known risk:** `@resvg/resvg-js` hasn't released since early 2024, though it's heavily used and ships prebuilt
  linux x64 and arm64 binaries. If it becomes a problem, the rasteriser is swapped behind `render()` without
  touching templates.

**Options considered:**

- **Takumi:** a newer Rust renderer that goes straight from JSX to PNG and is actively maintained, but much less
  adopted. It's the swap candidate.
- **`next/og`:** the same engines, with less control.
- **Headless Chromium:** too heavy for a shared node.

### 9. Source text extraction: PDF.js for PDFs, a readable-text extractor for web pages

**PDFs:**

- `pdfjs-dist` runs in the worker. It extracts text page by page with positions, which we assemble into lines and
  reading order, and stores per page.
- The admin's PDF viewer uses the same library, with its text layer used to highlight matched quotes. The text we
  match against and the text the reviewer sees highlighted come from one engine, so they can't disagree.

**Web pages:** the readable text is extracted in the worker (Mozilla Readability or equivalent; the library is
picked when added, at its latest stable version) and stored with section anchors, next to the archive snapshot.

**Not extracted:** scans, social posts and video don't go through extraction. They use the attested path
(ADR-0002).

**Before M2:** a short spike against **real programme PDFs** supplied by the chapter. They're used locally and never
committed, since fixtures stay fictional. The spike checks reading order on real layouts.

**Options considered:**

- **Poppler `pdftotext`:** good extraction, but a second engine that can disagree with the viewer. It's kept as a
  cross-check if PDF.js struggles.
- **ML layout extractors (Docling, Marker, hosted parsers):** heavy, and they "clean" text, which works against
  verbatim matching.

### 10. Dependency versions

- Every dependency uses its **latest stable release**: never alpha, beta, rc, canary or `next` tags.
- Versions are checked against the npm registry when a dependency is added, not taken from memory.
- "Latest" is subject to the 3-day minimum release age inherited from slango and gifcept (pnpm
  `minimumReleaseAge` and Renovate). A release newer than that is picked up once it clears the delay.
- Renovate keeps dependencies current afterwards.

### 11. Toolchain, adopted from @slango and gifcept as-is

- Node 26.11, pnpm 12.10, Turbo 2.11, ESM.
- **TypeScript 7 (tsgo)**, via `@slango.configs/typescript`.
- Linting and formatting:
  - `@slango.configs/oxlint`, run as `--type-aware --max-warnings 0`;
  - `@slango.configs/prettier`.
- Tests and hooks:
  - `@slango.configs/vitest`;
  - `@slango.configs/lint-staged` with husky;
  - Changesets.
- Renovate with a 3-day minimum release age; base images pinned by digest.
- Packages:
  - **Used:** `@slango/reazione` (React hooks).
  - **Optional:** `@slango/tessera`.
  - **Not used:** `@slango/mangusta`, which is Mongoose-only.
  - **Not until fixed:** `@slango/ristretto` lacks a `"."` export, and its global middleware is unsafe for
    per-tenant requests.
- Playwright and Postgres test helpers are added in this repo, because slango doesn't provide them.

## Still open

These are smaller choices. Each has a default we'll use unless the owner objects.

| Topic                          | Default                                                                                                                                                                                | Alternative                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Job queue                      | pg-boss (Postgres-backed)                                                                                                                                                              | graphile-worker                                   |
| Postgres in tests              | `postgres:18` container on the self-hosted runner (it already runs Docker)                                                                                                             | `embedded-postgres` binaries                      |
| Keeping the public cache fresh | An in-app cache keyed by the published version. On publish the API calls an internal revalidate endpoint on each web replica, and a cheap version check every ≤60 s is the safety net. | Next ISR with a shared cache handler              |
| Host rewrite                   | Next `proxy.ts`, excluding `/_next/*` and static paths                                                                                                                                 | —                                                 |
| CSP                            | No nonces on the cached public site; nonces only in admin                                                                                                                              | —                                                 |
| Image architecture             | Match gifcept's build approach (the runner is arm64)                                                                                                                                   | —                                                 |
| Forms and validation           | zod (shared API and UI schemas) plus react-hook-form, as in gifcept                                                                                                                    | Ark field components with plain server validation |
| Admin data fetching            | Server components plus TanStack Query for interactive views, as in gifcept                                                                                                             | Server components only                            |

## Evidence (checked when this ADR was written)

- **Latest stable versions in the npm registry when this ADR was written:**

  | Area          | Packages                                                                                         |
  | ------------- | ------------------------------------------------------------------------------------------------ |
  | Frontend      | `next` 16.4.0, `react` 19.3.0, `@pandacss/dev` 2.1.2, `@ark-ui/react` 5.39.3, `next-intl` 4.14.9 |
  | API and data  | `fastify` 5.12.5, `kysely` 0.29.6, `kysely-codegen` 0.20.0, `pg` 8.23.1, `dbmate` 2.36.0         |
  | Auth and jobs | `better-auth` 1.7.7, `pg-boss` 12.37.0                                                           |
  | Testing       | `@playwright/test` 1.64.0, `vitest` 5.0.3                                                        |
  | Toolchain     | `typescript` 7.0.2, `oxlint` 1.87.0, `turbo` 2.11.7                                              |

- **Next.js security:** the `next/og` RCE that OpenNext's release notes report affected 16.2.0–16.3.5. Any current
  16.x release is past it.
- **Next.js 16 routing:** the old `middleware.ts` is replaced by `proxy.ts`, which runs only on Node.js.
- **Better Auth:** has a two-factor plugin with TOTP and backup codes.
- **Prisma:** 7.10 is current. Its schema and migration language doesn't model RLS policies, and native RLS support
  is only in early access. ([client extensions](https://www.prisma.io/docs/orm/v7/prisma-client/client-extensions),
  [Atlas guide to Prisma with RLS](https://atlasgo.io/guides/orms/prisma/row-level-security))

## Consequences

**Benefits:**

- One data layer, reviewable in one place.
- The internet-facing Next app holds no DB credentials.
- Background work has a proper home.
- Future clients reuse the API.

**Costs and risks:**

- Three deployables (web, admin, API) plus a worker, compared with two for a Next-only design.
- The public site depends on the API for cold pages. The four guardrails limit the impact.
- **TypeScript 7 spike: done; the stack is compatible.** Every chosen library type-checks under TS 7.0.2 at its
  latest stable version, with the slango preset's `skipLibCheck: true`. Some libraries' own declaration files
  fail with `skipLibCheck: false`: Better Auth, Fastify (through pino), pg-boss, next-intl and Panda's types. TS 6
  fails identically, so these aren't TS 7 problems, and **`skipLibCheck` stays on**. At runtime:
  - Kysely transactions with `set_config` and `jsonArrayFrom` returned correct rows on Postgres 18;
  - kysely-codegen generated types from a schema with `uuidv7()` keys, an enum and jsonb;
  - satori plus resvg rendered a PNG;
  - pg-boss processed a job.
- **`@sentry/node` 11 is heavy on disk:** it ships its build plugins and the Sentry CLI as runtime dependencies,
  adding about 185 MB to the API's production install. Memory is barely affected (about 6 MB more resident). A
  hand-built `@sentry/core` client would avoid it, but isn't worth owning for now.
- **What the spike changed:**
  - Web-page extraction uses **jsdom** with Readability. linkedom's types conflict with `lib.dom`.
  - Better Auth has no Fastify helper. It's mounted through the documented `Request` bridge plus `fromNodeHeaders`
    from `better-auth/node`. Import plugins from their own entry points, e.g. `better-auth/plugins/two-factor`.
  - Panda 2 needs `@pandacss/preset-base` and `@pandacss/preset-panda` listed in `presets`.
  - zod schemas given to Fastify are converted with `z.toJSONSchema(…, { target: 'draft-07' })`.
  - Sentry v11 renamed things: `dataCollection` replaces `sendDefaultPii`, and `withSentryConfig` now comes from
    `@sentry/nextjs/config`. In pdfjs 6, call `loadingTask.destroy()`.
  - kysely-codegen with `--default-schema app` needs `search_path=app` on runtime connections.
  - oxlint's type-aware rules need a root `tsconfig.json` that references the project configs. Without it they
    silently report nothing.
- **Fixed upstream in slango** (`@slango.configs/typescript` 3.0.0, `@slango.configs/vitest` 2.1.0):
  - a `node.json` preset (`types: ["node"]`, ES2022 lib, no DOM), because TS 7 no longer loads `@types/*`
    automatically. `apps/api` and the Node packages extend it; the Next apps extend `next.json`;
  - no path aliases in the presets: Next's Turbopack doesn't resolve `${configDir}` in `paths`, so each app declares
    its own aliases relative to its tsconfig;
  - no `composite` or `incremental`: Turbo caches `dist/` but not TypeScript's `.tsbuildinfo`, and the two can drift
    into stale declarations;
  - the vitest presets are written in TypeScript and ship declarations, so configs are `vitest.config.ts`.
