# ADR-0003: Application stack

- **Status:** Pending. This file records the inputs and options only; the owner makes the decision.
- **Date:** 2026-10-08
- **Decide before:** any M1 work that depends on the framework. The SQL, RLS and test-matrix work in M1 does not,
  so it can start before this is decided.
- **Relates to:** BRIEF §5, §6, §8; [ADR-0001](0001-hosting-and-delivery.md),
  [ADR-0002](0002-tenancy-and-authorization.md)

## Fixed inputs

- **Language and tooling:** TypeScript strict, using the `@slango.configs/*` packages, plus `@slango/*` packages
  where they help.
- **Two separate deployables:**
  - **Public site:** no auth, cacheable, mobile-first.
  - **Admin app:** sessions plus TOTP, invite-only, served from one central host.
- **Data access:** Postgres 18, always through `withActor` (ADR-0002). SQL migrations are the source of truth.
- **Share images:** PNGs generated server-side in four sizes. Satori plus resvg works in any Node runtime.
- **Languages:** Spanish first; Catalan, Basque and Galician later; `hreflang` across locales.
- **Accessibility:** WCAG 2.2 AA.
- **End-to-end tests:** Playwright.
- **Deployment:** Helm chart plus HTTPRoute, as in ADR-0001.
- **Caching:** an in-app cache with at least 2 replicas. A publish must be visible on every replica within
  60 seconds.

## Already settled by @slango and gifcept

These are adopted as-is:

- **Runtime and workspace:** Node 26.10, pnpm 12.9, Turbo 2.11, ESM.
- **Compiler:** TypeScript 7 (tsgo), via `@slango.configs/typescript`. It has `default.json` and `next.json`
  presets.
- **Lint and format:**
  - `@slango.configs/oxlint`, run as `--type-aware --max-warnings 0`.
  - `@slango.configs/prettier` (100-column width).
- **Tests:** `@slango.configs/vitest` 5.
- **Git hooks and releases:** `@slango.configs/lint-staged` with husky; Changesets, with pre-push requiring one.
- **Supply chain:** Renovate with a 3-day minimum release age, and digest-pinned base images.
- **Delivery:** gifcept's CD flow, as described in ADR-0001.

Because the stack is on TypeScript 7, every dependency we pick has to work under tsgo, including any ORM code
generation. Root-level config files also need to be added to oxlint's `ignorePatterns`.

## @slango packages

| Package | Use it? | Why |
|---|---|---|
| `@slango/reazione` | If React is chosen | React 19 hooks, safe for server rendering |
| `@slango/tessera` | Optional | Utility types |
| `@slango/mangusta` | No | Mongoose only |
| `@slango/ristretto` | Not until fixed | The bare import is broken (its `exports` has no `"."` entry), and its module-level middleware registry is unsafe for per-tenant server requests |

slango does not provide Playwright setup, Postgres test helpers, i18n or a markdownlint config. We can add these
in this repo, or upstream in slango if the owner prefers.

## To decide

| Topic | Options | Notes |
|---|---|---|
| App framework | **(a)** Next.js only: two Next.js 16.3.x apps (public and admin), using route handlers and server actions, no separate backend · **(b)** gifcept-style Next.js plus a NestJS API · **(c)** something else | slango has first-class Next.js presets. Most business rules live in Postgres (ADR-0002), so (a) has one fewer thing to deploy. The owner isn't set on NestJS. |
| Auth | Better Auth 1.7.x (sessions in Postgres, a TOTP plugin; the Auth.js team now works on it) · custom, like gifcept (JWT in a cookie) | Must support TOTP, invite-only sign-up, `__Host-` cookies on one host, and sessions that can be revoked in the database |
| DB access and migrations | Plain SQL migrations with a runner (dbmate, node-pg-migrate or graphile-migrate) · Kysely or Drizzle for typed queries | Every query goes through `withActor`. Code generation must work under tsgo. |
| Postgres in tests | A `postgres:18` service container (needs Docker on the self-hosted runner) · `embedded-postgres` binaries (the equivalent of gifcept's mongodb-memory-server) | Must run on the self-hosted runner |
| Error tracking | Sentry Free (one user) · GlitchTip, self-hosted on the cluster | — |
| Rendering and caching | Next.js ISR, which with 2+ replicas needs a shared cache handler or LISTEN/NOTIFY invalidation · an in-app cache keyed by the published version | Publishes must be visible within 60 seconds |
| Host rewrite | Next.js `proxy.ts` (runs in Node, in-process; self-hosting means no per-request cost), excluding `/_next/*` and static paths | Implements `resolve()` from ADR-0002 |
| CSP | No nonces on the cached public site; nonces only in the admin app | — |

## Evidence (checked when this ADR was written)

- **Next.js:** 16.4 is brand new. gifcept already runs **16.3.8**, which is past the `next/og` RCE that
  OpenNext's release notes report for 16.2.0–16.3.5. Since Next.js 16, the old `middleware.ts` is replaced by
  `proxy.ts`, which runs only on Node.js.
- **SvelteKit:** version 3 is a brand-new major. slango has no Svelte presets.
- **Better Auth:** 1.7.3 is the current release. It has a two-factor plugin with TOTP and backup codes.

## Lean (not binding)

**(a) Next.js only, plus Better Auth, plain SQL migrations and Kysely.** The owner decides.
