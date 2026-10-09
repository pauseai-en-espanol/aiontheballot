# Plan: Spain pilot ("IA en las urnas")

This plan covers the milestones, what to cut if we fall behind, the open decisions, and the questions and pushback
on the brief. Scope comes from [BRIEF.md](BRIEF.md); decisions are recorded in [adr/](adr/).

## Goal

- **Launch:** the Spain pilot is public before the official campaign starts (BRIEF §10).
- **Preview:** earlier, with real parties and criteria and every cell shown as _pending_.

Election facts live only in docs and data, never in code.

## How we work

This is a side project:

- Claude implements in small PRs, each with a demo script.
- Dani reviews and decides:
  - **Line by line:** migrations, RLS, routing and gitops changes.
  - **By demo:** the UI.

If review falls behind, the cut list below is applied at the preview go/no-go.

## Specs, written just in time

Each spec is reviewed by Dani before the milestone that builds it starts:

| Spec                                                                                                 | Ready before | Status                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------- |
| [Data model](spec/data-model.md)                                                                     | M1           | Draft for review                                        |
| Editorial workflow (user stories and acceptance criteria per role)                                   | M2           | Written during M1                                       |
| Public site (page content, mobile layouts, display states, share-image layouts, performance budgets) | M3           | Written during M2, with chapter input on public wording |

## Milestones

The milestones run in order. M2 and M3 overlap, and M4 is gated. Every milestone ends with green CI and a short
demo, recorded in [Tracking](#tracking).

### M0: Decisions and skeleton

**Ships:**

- **First task: TypeScript 7 spike.** Confirm Kysely, kysely-codegen, Better Auth and Fastify type-check under
  tsgo (ADR-0003).
- **Decisions:** the remaining small choices in ADR-0003 settled, and D2 decided.
- **Repo**, set up on the slango toolchain:
  - pnpm and Turbo, TypeScript 7, oxlint, Prettier, Vitest;
  - lint-staged and husky, Changesets;
  - Renovate with a 3-day release delay;
  - plus Playwright, which gifcept doesn't use.
- **Docs and licences:**
  - `LICENSE` (AGPL-3.0-or-later) and `LICENSE-CONTENT` (CC BY 4.0);
  - CONTRIBUTING.md, including the new-table checklist;
  - a markdownlint config.
- **CI**, on the self-hosted runner:
  - lint, `build:check`, unit tests;
  - DB tests against Postgres 18;
  - a migration check: apply all migrations to a fresh database, and reject edits to merged migrations;
  - a Playwright smoke test against a production build.
- **CD**, following the gifcept flow, with gifcept's known pitfalls fixed:
  - no `pull_request_target`;
  - a pinned `yq`;
  - resource limits and a securityContext on every pod.
- **Deployment:**
  - an umbrella Helm chart with `route:`;
  - a Harbor project with pull and push robots.
- **A gitops PR** that adds:
  - the ApplicationSet: one environment, production, tracking `main` until the preview (no staging, ADR-0001);
  - the AppProject entry and SealedSecrets;
  - DNS and a certificate SAN for `iaenlasurnas.es`;
  - `aiontheballot_web`, `aiontheballot_admin` and `aiontheballot_worker` as `extraRoles` of the `aiontheballot`
    database (D1);
  - GlitchTip (cluster-wide, VPN-only UI, a database on the shared Postgres), in a follow-up gitops change.

**Demo:** a PR goes green in CI, and the hello-world page loads on `iaenlasurnas.es` over TLS through
`gateway-public`.

### M1: Schema, RLS, routing and backups

**Ships:**

- **Schema:** the full schema, including the tables M2 and M4 will need.
- **Database security:**
  - roles (D1), grants and RLS policies;
  - triggers for the data rules and platform invariants.
- **Seeds:** fictional seed data, with a guard that refuses to run against production.
- **Tests:** the generated isolation matrix and the catalog meta-tests (ADR-0002).
- **Routing:** `resolve()`, plus integration tests in the CI end-to-end stack, which has the fictional seeds.
- **Backups:** the backup CronJob (D2) **and a restore test**.

**Demo:**

- CI shows the matrix test count, all green.
- `curl` against production: an unknown host returns 404 and the internal path prefix returns 404. Alias 301s
  need seeded tenants, so they are shown in the CI end-to-end stack.
- A data-rule test that should fail is shown failing.
- A dump is restored successfully.

### M2: Admin and editorial workflow

**Ships:**

- **Access:** sign-in by invitation plus TOTP; a tenant switcher.
- **Content setup:** create and edit elections, methodology, external reviewers, parties and criteria.
- **Sources:** PDFs and web pages, stored in `app.files` with extracted text (pages or sections), a SHA-256 hash
  and an archive snapshot. Other kinds go through the attested path.
- **Cell editing:** a cell editor that gives live feedback on whether each quote matches the source verbatim.
- **Workflow:**
  - submit, review, publish, reject and withdraw;
  - change requests for elections that are already live.
- **Records:** history, the corrections log, the right-of-reply triage queue and an audit view.
- **Caching:** the public cache is invalidated on publish.

**Demo:**

- Two users take a cell from draft to published.
- Self-review, a missing quote and a quote that doesn't match the source are all rejected.
- Editing a criterion in a live election requires approval from someone else.

### M3: Public site (overlaps M2)

**Ships:**

- **Scorecard:** a desktop table, plus **per-party and per-criterion card views on mobile**.
- **Pages:**
  - party, criterion and cell detail;
  - methodology, about the operator, corrections log;
  - _aviso legal_ (legal notice), privacy policy;
  - contact and report-an-error form.
- **Platform invariants:** the "An initiative of {operator}" line and the methodology link in the shared layout.
- **Share images** in four sizes.
- **SEO:** canonical URLs, sitemaps and `hreflang` groundwork.
- **Security and traffic:** CSP and security headers; the Envoy rate-limit policy.
- **Analytics:** Plausible.
- **Coming soon:** a branded _próximamente_ page on the public hosts until the preview. The real site is visible
  only on a preview host on `gateway-private`, reachable over the VPN, so skipping the page needs no cookie or login
  on the public site.

**Demo:**

- A walkthrough on a phone and on a desktop.
- The invariant crawler and the share-image template test pass.
- axe reports zero accessibility violations.

### Preview

**Ships:** real parties and criteria, every cell _pending_, live on `iaenlasurnas.es` with the
`elecciones.pauseai.es` alias redirecting to it.

**Before it:** production switches from `main` to the `production` branch (ADR-0001), and D6 is decided.

**Gate:** a preview go/no-go. That is also where the cut list is applied if we're behind.

### M5: Hardening and launch

**Ships:**

- **Review:** a second person reviews the RLS policies and the matrix.
- **Security audit:** headers, CSP, dependencies and secrets.
- **Load test** (where: D6): requests per second for HTML and for images, and how much of the uplink they use.
- **Cloudflare-proxy contingency:** tested once (where: D6).
- **Accessibility:** a manual pass.
- **Backups:** a full **restore drill**.
- **Runbooks:** incidents, corrections, reflection-day freeze, moving to other hosting, domain renewal.
- **Monitoring:** off-node uptime monitors on every hostname.

**Demo:** the launch checklist is signed off at the launch go/no-go, followed by a code freeze in which only
content changes and hotfixes go in.

### M4: LLM-assisted extraction

**Gated.** By default it comes **after launch**, behind a feature flag. Building it before launch only happens if M1
is done and M2 is on track.

**Ships:**

- **`Extractor` interface**, with the Anthropic API as the default provider.
- **Per-criterion suggestions:** candidate passages with page numbers, a suggested rating and a rationale.
- **Verbatim check:** proposed quotes that don't match the source are rejected automatically.
- **Provenance and cost:** model, prompt version and run date stored for each suggestion; cost recorded per run,
  with a cap.

**Demo:** on a fictional fixture programme, an unmatched quote is rejected and provenance and cost are stored.

### Gates

| Gate             | Check                                                        |
| ---------------- | ------------------------------------------------------------ |
| During M1        | The isolation matrix runs in CI                              |
| During M2        | M4 go/no-go before launch; content from the chapter on track |
| Preview go/no-go | Ready to show the preview; apply the cut list if behind      |
| Launch go/no-go  | Launch checklist signed off                                  |

## Content we need from the chapter

| What                                                                                        | Needed for     |
| ------------------------------------------------------------------------------------------- | -------------- |
| Legal-notice data: legal name, NIF, address, registry entry, contact                        | M3 legal pages |
| Criteria wording, methodology text, named external reviewers                                | Preview        |
| Rule for which parties are included, plus the party list (after candidacies are proclaimed) | Preview        |
| Privacy policy and right-of-reply policy texts                                              | Preview        |
| Editors and reviewers invited and set up with TOTP                                          | Preview        |

## If launch is at risk, cut in this order

1. **M4 entirely.** Entering evidence by hand is the launch path anyway.
2. **Share-image breadth.** Launch with 1200×630 and 1080×1080 for the overview and parties only.
3. **The per-criterion page.**
4. **The report-an-error web form.** Temporarily replace it with a published email address, and log submissions
   by hand. The right of reply itself stays.
5. **Admin polish:** the history diff view, bulk editing, and theming beyond logo and colours.
6. **Load-test depth.**

**Never cut:**

- RLS and the isolation matrix.
- The hostname rules.
- The evidence requirement, four-eyes review and verbatim match.
- History and the corrections log.
- The operator line and the methodology link.
- The legal pages.
- Ratings shown by icon plus text plus colour.
- CSP and security headers.
- Off-node backups and the restore drill.

## Later: an MCP server for feeding in information

An MCP server would let AI tools feed information into the platform, such as programme passages and draft
evidence. It comes after launch, and after M4. It would be another client of the Fastify API, under the same rules
as the LLM pipeline:

- **It acts as a real actor:** through `withActor`, using a user-delegated token or a service account with a
  membership.
- **It can only create drafts and suggestions, never publish.** Four-eyes review and the verbatim-match triggers
  apply.
- **Everything it writes carries provenance** (tool, run) and goes to the audit log.

## During the campaign

- Check for new party programmes and update cells as they appear.
- Handle corrections within a stated turnaround time.
- Apply the reflection-day behaviour agreed under Q8.
- Archive the election after the results.

## Open decisions for Dani

D1 and D3–D5 are decided (see [Answered](#answered)).

| #   | Decision                                                      | Recommendation                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2  | Where off-node backups go                                     | An app-owned, encrypted `pg_dump` (hourly during the campaign), sent to whichever off-node target the cluster backup plan uses (MinIO on the Mac, or Google Drive via rclone-crypt). It must work before the preview.                                         |
| D6  | Where pre-production checks run, now that there is no staging | Rehearse each migration against the latest backup restored into a throwaway database (it doubles as the restore test). Run the M5 load test and the Cloudflare-contingency test against production before launch, at a quiet hour. Decide before the preview. |

## Questions for the chapter

- **Q5. Content.** Please supply the criteria list, methodology text, external reviewers, and the **rule for which
  parties are included**. The rule must be stated in the methodology. Can the party list still change after
  candidacies are proclaimed, for example through appeals?
- **Q6. Legal notice.** Article 10 of the LSSI appears to require registry details and a contact address beyond
  the fields in the brief. Proposal: add `registry_entry` and `contact_email` to `organizations`. Please confirm
  with counsel.
- **Q7. Personal data.** How long should right-of-reply submissions be kept, and who is the privacy contact?
- **Q8. Electoral law.** Has the association had advice on publishing or updating the table during the campaign,
  and on **reflection day**? There will be a per-election _freeze_ switch; whether and when to use it is the
  chapter's call.
- **Q9. Admissible sources.** Which kinds of source can back a rating? Options: official programmes and documents
  only, or also web pages, debate and interview statements, and social posts. The platform supports all of them
  (PDFs and web pages are matched automatically; the rest need a second person to attest them). Restricting to
  official documents is the most defensible.

## Pushback and clarifications on the brief

My default is in brackets.

- **P1. Canonical hostnames.** "Exactly one canonical hostname per tenant" can't describe tenants that exist only
  on the shared platform domain. [At most one; without one, the canonical URL is `platform-host/{slug}`.]
- **P2. Platform admins.** `platform_admin` isn't scoped to a tenant, so it shouldn't be a tenant membership.
  [A separate `platform_admins` table.]
- **P3. Verbatim matching.** Apply it to **every** quote, not only those the LLM proposes. For sources with no
  extractable text, a second person must attest the quote. [Yes.]
- **P4. Four-eyes.** "Author" means **anyone who edited the revision**, not just its creator. [Yes.]
- **P5. MFA.** TOTP is **mandatory** for every admin role and enforced in the database. [Yes.]
- **P6. Descriptive methodology.** What distinguishes "red = no position" from "No lo menciona"? This doesn't
  block Spain, which uses the `demands` methodology.
- **P7. Pending vs not mentioned.** "Pending (not yet assessed)" is a display state, not a rating, and must not be
  confused with "No lo menciona". [Please confirm the public wording.]
- **P8. Stored programme copies.** They stay private for copyright reasons. The public sees the source URL, the
  archived snapshot and our hash. [Yes.]
- **P9. Share images.** Add "Actualizado: {fecha}" to party and cell images, so old screenshots are recognisable.
  This changes the fixed template (invariant 4). [Yes.]
- **P10. LLM extraction.** M4 moves after launch by default, since party programmes arrive late anyway. [Yes.]
- **P11. Personal data and platform admins.** Platform admins can't read right-of-reply personal data in the app.
  A platform admin could grant themselves a membership, but that is audited and visible to the tenant. [Yes.]
- **P12. Hosting ownership.** §11 says the association owns hosting accounts, but `danilupion-com` is a personal
  cluster. [Acceptable for the pilot, because the cluster is treated as replaceable compute:
  - the association owns the repo, domain, DNS zone, mail sender, error-tracking account and LLM key;
  - deployment is fully declarative;
  - a runbook for moving to another host ships in M5.
    Revisit after the election.]
- **P13. Preview deployments.** There are no per-PR previews (§8 asks for them). A temporary stack spun up in CI
  for end-to-end tests replaces them, and UI demos run locally with the fictional seeds. [Yes. The staging
  instance first planned here was dropped (ADR-0001).]

## Answered

| Topic                                                 | Answer                                                                                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who builds it                                         | Side project: Claude implements, Dani reviews                                                                                                                                                                              |
| Hosting                                               | `danilupion-com`, following the gifcept pattern; Cloudflare for DNS only                                                                                                                                                   |
| Domain                                                | `iaenlasurnas.es` is already registered                                                                                                                                                                                    |
| Licence                                               | AGPL-3.0-or-later for code, CC BY 4.0 for our content. Party quotes are not ours to license. Names and logos are excluded.                                                                                                 |
| Tooling                                               | Use the `@slango.configs` packages, and `@slango` packages where useful                                                                                                                                                    |
| D3: admin host                                        | One central host, `admin.iaenlasurnas.es`, configurable. Tenant context comes from the path; per-tenant admin hosts can be added later; platform admins stay central.                                                      |
| D4: repo                                              | `pauseai-en-espanol/aiontheballot`                                                                                                                                                                                         |
| D5: stack ([ADR-0003](adr/0003-application-stack.md)) | Next.js web and admin, plus a Fastify API and worker that own all data access. Better Auth with mandatory TOTP. dbmate and Kysely, no ORM. Latest stable dependency versions.                                              |
| D1: non-owner DB roles                                | halyard `postgresql` chart 1.1.0 adds `databases[].extraRoles`: login roles that own nothing, forced `NOSUPERUSER … NOBYPASSRLS`, with `CONNECT` on their database. Our migrations (as owner) grant them table privileges. |
| Environments                                          | One, production, with no staging (ADR-0001). It tracks `main` until the preview, then a `production` branch the owner fast-forwards.                                                                                       |
| Names                                                 | `aiontheballot` everywhere: repo, packages (`@aiontheballot/*`), chart, images, Harbor project, namespace, database and roles. The product name is configuration (`PLATFORM_NAME`).                                        |

## Tracking

| Milestone | Status                                                                                                                                                                           | Demo note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | In progress: everything shipped except GlitchTip (a follow-up gitops change). Green CI and an automatic release on the self-hosted runner; deployed by Argo CD on danilupion-com | TS 7 spike passed. Public app serves with no cookies. 34 database tests: catalog meta-tests, normaliser parity, immutability triggers, isolation-matrix harness. Images run as non-root; the CI database job replayed locally against a fresh Postgres. Playwright smoke on production builds, which caught the platform name being fixed at build time. Demo: `iaenlasurnas.es` and `admin.iaenlasurnas.es` serve over TLS through `gateway-public`, titled from `PLATFORM_NAME`, no cookies; migrations ran as `aiontheballot_owner` before the pods started, and the runtime roles own nothing and cannot bypass RLS |
| M1        | Not started                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M2        | Not started                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M3        | Not started                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Preview   | Not started                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M5        | Not started                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M4        | Gated                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
