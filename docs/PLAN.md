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

| Spec                                                                                             | Ready before | Status                                                  |
| ------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------- |
| [Data model](spec/data-model.md)                                                                 | M1           | Approved                                                |
| [Editorial workflow](spec/editorial-workflow.md) (user stories and acceptance criteria per role) | M2           | Drafted; awaits review                                  |
| [Public site](spec/public-site.md) (modes, addresses, pages, layouts, display states, headers)   | M3           | Drafted (R121); awaits review and the chapter's wording |

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
  - plus Playwright.
- **Docs and licences:**
  - `LICENSE` (AGPL-3.0-or-later) and `LICENSE-CONTENT` (CC BY 4.0);
  - CONTRIBUTING.md, including the new-table checklist;
  - a markdownlint config.
- **CI**, on the self-hosted runner:
  - lint, `build:check`, unit tests;
  - DB tests against Postgres 18;
  - a migration check: apply all migrations to a fresh database, and reject edits to merged migrations;
  - a Playwright smoke test against a production build.
- **CD**, with the usual pitfalls avoided:
  - no `pull_request_target`;
  - a pinned `yq`;
  - resource limits and a securityContext on every pod.
- **Deployment:**
  - an umbrella Helm chart with `route:`;
  - a container-registry project with pull and push robot accounts.
- **A gitops PR** that adds:
  - the ApplicationSet: one environment, production, tracking `main` until the preview (no staging, ADR-0001);
  - the AppProject entry and SealedSecrets;
  - DNS and a certificate SAN for `iaenlasurnas.es`;
  - `aiontheballot_web`, `aiontheballot_admin` and `aiontheballot_worker` as login roles of the `aiontheballot`
    database (D1);
  - GlitchTip, in a second gitops change.

**Demo:** a PR goes green in CI, and the hello-world page loads on `iaenlasurnas.es` over TLS through the public
gateway.

### M1: Schema, RLS, routing and error tracking

**Ships:**

- **Schema:** the full schema, including the tables M2 and M4 will need.
- **Database security:**
  - roles (D1), grants and RLS policies;
  - triggers for the data rules and platform invariants.
- **Seeds:** fictional seed data, with a guard that refuses to run against production.
- **Tests:** the generated isolation matrix and the catalog meta-tests (ADR-0002).
- **Routing:** `resolve()`, plus integration tests in the CI end-to-end stack, which has the fictional seeds.
- **Error tracking:** the GlitchTip SDKs in the API and both Next apps, the browser error relay, and personal-data
  scrubbing (ADR-0003 §7).

Backups are not part of M1: they come from the cluster's backup plan (D2) and must work before the preview.

**Demo:**

- CI shows the matrix test count, all green.
- `curl` against production: an unknown host returns 404 and the internal path prefix returns 404. Alias 301s
  need seeded tenants, so they are shown in the CI end-to-end stack.
- A data-rule test that should fail is shown failing.
- A browser error from each Next app reaches its own GlitchTip project through the relay, with no personal data:
  in the end-to-end suite against a fake GlitchTip, and in production with one fictional test event per app.

### M2: Admin and editorial workflow

**Ships:**

- **Access:** sign-in by invitation plus TOTP; a tenant switcher. `private.accept_invitation(token)` comes with
  Better Auth's tables, since it checks the invited email against the user's verified email. A daily job deletes
  expired sessions Better Auth never meets again (personal data, R81).
- **The first account:** sign-in is invitation-only, so the first platform admin needs a way in without one (a
  command only the owner can run). Making them a platform admin is then a row in `app.platform_admins`, added
  as the owner, since the app has no write path to it.
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
- Self-review (while the election requires a second reviewer), a missing quote and a quote that doesn't match the
  source are all rejected.
- Editing a criterion in a live election requires an approved change request with a public note, and a second
  person when the tenant requires one.

### M3: Public site (overlaps M2)

**Ships:**

- **Scorecard:** a desktop table, plus **per-party and per-criterion card views on mobile**.
- **Pages:**
  - party, criterion and cell detail;
  - methodology, about the operator, corrections log;
  - _aviso legal_ (legal notice), privacy policy;
  - contact and report-an-error form.
- **Platform invariants:** the "An initiative of {operator}" line and the methodology link in the shared layout.
- **Share images** in four sizes, and link previews for every view (see Social sharing).
- **SEO:** canonical URLs, sitemaps and `hreflang` groundwork.
- **Security and traffic:** CSP and security headers; the Envoy rate-limit policy.
- **Analytics:** Plausible. Brought forward to the coming-soon page (R83).
- **Coming soon:** a branded _próximamente_ page on the public hosts until the preview. The real site is visible
  only on a preview host on a private gateway, not reachable from the internet, so skipping the page needs no
  cookie or login on the public site. Since R174, the preview is shown through the admin to the site's members
  instead (ADR-0005).

**Demo:**

- A walkthrough on a phone and on a desktop.
- The invariant crawler and the share-image template test pass.
- axe reports zero accessibility violations.

### Preview

**Ships:** real parties and criteria, every cell _pending_, live on `iaenlasurnas.es` (its only address: R134).

**Before it:**

- D6 is decided;
- off-node backups work (D2): the cluster's backup plan (gitops) covers the database and the file volume, and a
  dump of the `aiontheballot` database has been restored into a scratch database, with the file volume's copy from
  after it (ADR-0004).

**Gate:** a preview go/no-go. That is also where the cut list is applied if we're behind.

### M5: Hardening and launch

**Ships:**

- **Review:** a second person reviews the RLS policies and the matrix.
- **Security audit:** headers, CSP, dependencies and secrets.
- **Load test** (where: D6): requests per second for HTML and for images, and how much of the uplink they use.
- **CDN-proxy contingency:** tested once (where: D6).
- **Accessibility:** a manual pass.
- **Backups:** a full **restore drill**, the file volume included.
- **Runbooks:** incidents, corrections, reflection-day freeze, moving to other hosting, domain renewal, and restoring
  the database, whose steps include deleting the sweep's ledger (`sweep-ledger.json`, ADR-0004 §5). _Written:
  [docs/runbooks/](runbooks/README.md) and the [launch checklist](launch-checklist.md) (R152, R153); the restore
  drill is still to run._
- **Monitoring:** external uptime monitors on every hostname.

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
| Preview go/no-go | Ready to show; backups restored; apply cut list if behind    |
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
2. **Share-image breadth.** Launch with 1200×630 and 1080×1080 for the overview and parties only. Link previews
   themselves are never cut.
3. **The per-criterion page.**
4. **The report-an-error web form.** Temporarily replace it with a published email address, and log submissions
   by hand. The right of reply itself stays.
5. **Admin polish:** the history diff view, bulk editing, and theming beyond logo and colours.
6. **Load-test depth.**

**Never cut:**

- RLS and the isolation matrix.
- The hostname rules.
- The evidence requirement, the four-eyes mechanism (on by default; see P14) and verbatim match.
- History and the corrections log.
- The operator line and the methodology link.
- Link previews (Open Graph and Twitter tags with a share image) on every public view.
- The legal pages.
- Ratings shown by icon plus text plus colour.
- CSP and security headers.
- Off-node backups and the restore drill.

## Later: an MCP server for feeding in information

Brought forward (Dani, 2026-10-15): built as PLAN R202–R204, [ADR-0008](adr/0008-member-tokens-for-tools.md).

An MCP server would let AI tools feed information into the platform, such as programme passages and draft
evidence. It comes after launch, and after M4. It would be another client of the Fastify API, under the same rules
as the LLM pipeline:

- **It acts as a real actor:** through `withActor`, using a user-delegated token or a service account with a
  membership.
- **It can only create drafts and suggestions, never publish.** Four-eyes review and the verbatim-match triggers
  apply.
- **Everything it writes carries provenance** (tool, run) and goes to the audit log.

## Later: development speed (noted, not built)

What slowed this work down, and what would help, for when there is time (Dani asked for the ideas, not the work):

- **`pnpm verify` runs its steps one after another** (about 2.5 minutes, most of it the database tests and e2e). The
  database tests could run their files in parallel, each in its own database cloned from a migrated template
  (`CREATE DATABASE … TEMPLATE`), and e2e beside them on its own database.
- **Mutation checks edit the working tree,** so nothing else can be edited while one runs. Running each mutant in a
  temporary `git worktree` (sharing the built packages) would free the tree and let mutants run in parallel.
- **Argo CD polls the repository** (up to 3 minutes before a release starts rolling out). A GitHub webhook to Argo
  CD would sync at once.
- **Images build one after another** in the release; a matrix job per deployable, with BuildKit's registry cache,
  would cut a multi-image release to the slowest image.
- **The pre-commit hook type-checks whole packages;** `tsc --build` with its build info kept would check only what
  changed.

## During the campaign

- Check for new party programmes and update cells as they appear.
- Handle corrections within a stated turnaround time.
- Apply the reflection-day behaviour agreed under Q8.
- Archive the election after the results.

## Social sharing: a core requirement

The site spreads through people sharing it, before launch to build expectation and during the campaign to carry the
ratings. Every public page must give a good preview on every app (WhatsApp, X, Facebook, Telegram, LinkedIn,
Bluesky, Mastodon), and must give it fast: crawlers time out, and a slow or missing preview is a lost share.

**Shipped with the coming-soon page:**

- Open Graph and Twitter tags, the canonical address and `hreflang`, all from the routing table (never the Host
  header). `og:locale` is the language and the tenant's country.
- A share image in the A style in the four sizes (ADR-0003 §8), rendered by `packages/og` (satori, then resvg) with
  the fonts embedded. The link preview is about 50 KB; WhatsApp drops anything over about 300 KB.
- Content-hash URLs, `/og/{template}.{size}.{hash}.png`, cached for a year as `immutable`, with an ETag and 304s. A
  stale or made-up hash redirects to the current image (307) and never triggers a render.
- Pre-generation: rendering a page starts rendering its link preview, so it is ready when the crawler asks; each
  server pre-renders every tenant's link previews once it starts. Rendered images stay in a per-process cache.

**Every view, once the public site arrives (M3 and the campaign):**

- The overview, each party, each criterion, each cell, the methodology and the corrections log get their own title,
  description, canonical address and share image: a party's card shows its ratings, a cell's its rating and source,
  with "Actualizado" (P9) on party and cell cards. Alt text describes the rating in words.
- A download dialog offers the four sizes, since Instagram and stories have no link previews.
- On publish, the API's revalidation call (M2) names the views that changed, and every web replica pre-renders
  their link previews before anyone shares them. The content hash changes with the content, so a re-shared link
  gets the new picture.
- **Budgets:** a warm page under 300 ms of server time; a warm image under 100 ms and a cold one under a second;
  every image under 300 KB; no cookies and no client JavaScript needed for the tags.
- **Caching beyond the servers:** the image URLs are immutable, so a CDN in front of `/og/` would be safe. Putting
  a CDN's proxy in front is a gitops decision for when traffic needs it.
- **Tests:** e2e checks each view's tags and its image's size and dimensions; the template test checks the canonical
  address on every card. Before launch: Facebook's Sharing Debugger, LinkedIn's Post Inspector, and a real WhatsApp
  and Telegram send.

## Decisions to review (taken by Claude while Dani was away)

Each entry lists the options, the choice and why. The rule was the most conservative option: stricter security, less
scope, closest to the spec and ADRs. Revert any of them with a forward migration.

**Cell workflow (migration `assessment_workflow`):**

- **R1. Where a rejection's note comes from.** Options: a comment the rejecter writes in the same transaction; a new
  column on `assessments`; a session setting; making rejection an insert of a `rejected` event. **Chose the comment:**
  no schema change, no session flag, and members still insert only comments. The trigger copies its note into the
  `rejected` event.
- **R2. How a quote or checked-document change bumps its cell.** Options: a `SECURITY DEFINER` trigger; an `UPDATE`
  grant on `content_version`; a nested no-op `SET state = 'draft'` that the cell's trigger counts as an edit only at
  trigger depth > 1. **Chose the nested touch:** no new `SECURITY DEFINER` function and no new grant.
- **R3. How triggers write review events members may not.** The insert policy admits kinds other than `commented`
  only at trigger depth > 0. A caller can't run at depth > 0 except through our triggers, which never copy a kind
  from the caller.
- **R4. Who submits.** Editors and country admins (and platform admins), not reviewers, who "change only what
  reviewing needs" (spec §3.5). Recall is open to any contributor of the generation.
- **R5. A cell with a review trail can't be deleted.** Review events are immutable and reference the cell without
  cascade, so once submitted, a never-published cell stays (as a draft). The alternative, cascading, would delete
  history.
- **R6. Submitting in a draft election is allowed;** publishing there is not (spec §4).
- **R7. Step 9 of publishing** (next generation, clearing the change kind and note) runs in the cell's transition
  trigger when the table owner sets the cell `published`; only the owner may, so only the publish trigger can.
- **R8. `initial` in `draft_change_kind`** is refused when submitting, not when writing a draft.

**Evidence rules (migration `evidence_rules`):**

- **R9. Who attests.** Any member other than the quote's author (spec §6), not only reviewers. Attesting one's own
  quote while a second reviewer is required is a permission error (42501), like publishing one's own work.
- **R10. Attestations are set once** and undone by any content change of the quote; every update re-checks them.
- **R11. The 15-character minimum also applies after normalization,** so a quote padded with soft hyphens can't match
  almost anything.
- **R12. Submitting needs every quote matched or attested,** not just one: an unmatched quote couldn't be published
  anyway (`revision_evidence` admits only matched and attested quotes).
- **R13. An attestation file only needs to be in the `sources` bucket,** like a source's stored copy; its bytes are
  not checked separately.

**Reports (migration `reports`):**

- **R14. The daily cap is 200 reports per tenant and UTC day,** a constant in `submit_report()` rather than a tenant
  setting (the spec names no setting). It is a backstop behind the gateway's per-IP limit.
- **R15. A report may name any cell of a live or archived election of its tenant,** not only cells with a published
  revision: revisions arrive in the next migration, and a cell's id is not guessable.
- **R16. Triage follows the spec's arrows only:** `new → triaged → accepted | rejected | spam`; marking spam straight
  from `new` is not allowed (spec open item 9 leaves it to the editorial workflow spec).
- **R17. Anonymizing nulls all five personal-data columns at once,** and nothing else changes in that update.
  Afterwards the status can still change, but no personal data can be written again.
- **R18. Failure codes of `submit_report()`:** 22023 for a bad tenant, election or cell (the API can answer 404),
  54000 for the cap (429).

**Publishing (migration `publish`):**

- **R19. Uploaders of attestation files count as contributors,** like uploaders of source copies (spec §3.6 step 4
  says "uploaded files the draft cites"; an attestation file is one).
- **R20. Error classes:** a missing role or a four-eyes violation is a permission error (42501); state, version,
  election status and freeze window are 23001; missing content is 23514.
- **R21. Publishing does not require an active tenant.** Nothing of an inactive tenant is public anyway; requiring
  activity would block preparing a tenant before launch.
- **R22. `revision_internal.report_id` stays empty for now:** the draft has no column to carry a report link, and the
  editorial workflow (M2) decides how a report is attached.
- **R23. Fixture files are uploaded by each tenant's author,** not the platform admin, so the fixture publishers are
  never the uploaders of what they publish.

**Change control (migration `change_control`):**

- **R24. Approvers apply the change with their own rights** (spec: "as the approver"), with no new `SECURITY DEFINER`
  function. Reviewers write no structure, so in practice only country admins and platform admins can approve; a
  reviewer's approval is refused rather than silently doing nothing. Not so for a user with several roles: R144 makes
  it the change rules' own.
- **R25. An approval needs the target unchanged since the proposal;** otherwise it is refused and proposed again, so
  the public "before" value is always true.
- **R26. The values in change requests and structural changes are personal data** (a reviewer's name can be one), so
  the audit log keeps the request but not the values; the public record is `structural_changes`. Since R150 the
  public corrections log shows those values, but never an external reviewer's, and never names a retired one.
- **R27. Proposals are for live elections only;** slugs and the programme status are never change-requested.
- **R28. Withdrawing a pending proposal is a delete** by an editor or country admin; decided requests are never
  deleted.

**Programme status (migration `programme_status`):**

- **R29. Setting the status, even to the same value, counts as a check** and stamps its date (that is what "checked
  on" means publicly); the status may go back to pending, with no rule against it in the spec.
- **R30. "Published" needs a source of the party marked `is_programme`,** with or without a stored copy, as the spec
  says; the stored copy matters for the evidence rules, not for the status.

**Purge (migration `purge`):**

- **R31. `purge_log` names its tenant column `purged_tenant_id`** (and adds the slug and `leftovers`), instead of the
  spec's `tenant_id`: a `tenant_id` without a foreign key would need an exception in the tenant-ownership catalog
  test, which stays exception-free.
- **R32. Audit and cache-key writes are skipped during a purge only for sessions whose role is a member of the
  owner** (`session_user`), since both triggers run as `SECURITY DEFINER` and can't tell the caller otherwise.
- **R33. The purge refuses to finish if any table with a `tenant_id` still holds the tenant's rows,** rather than
  trusting its own list of tables.
- **R34. `purged_by` is the database session's role,** since a purge runs outside the app, with no actor.

**Seeds (`pnpm db:seed`, `packages/db/seeds/seed.ts`):**

- **R35. The production guard is "the database is on this machine"** (loopback host only, and never with
  `NODE_ENV=production`), with no override; it also refuses a database that holds any tenant but the seeds'. CI's
  service container is reached on localhost, so the CI end-to-end stack can use it.
- **R36. Seed content:** three fictional tenants (country codes XA, XB, XC): `ejemplo-a` on `ejemplo-a.localhost`
  with a verified alias and an unverified hostname, a live election, two parties, two criteria, a stored programme
  and one cell published through the real flow; `ejemplo-b` reachable only by path on `plataforma.localhost`, in
  Spanish and English; `ejemplo-inactivo`, inactive, with a verified hostname that must not be served. `.localhost`
  hostnames resolve to this machine in browsers, so the seeds work locally with no DNS setup.

**Routing (web `proxy.ts`, API `GET /public/routing`):**

- **R37. Without routing data the public site answers 503,** never a default tenant, but system paths (the kubelet's
  `/healthz`, build assets, the error relay) still pass, so a slow API can't restart the web pods.
- **R38. Tombstoned hostnames answer 404, not 410** (spec §3.1 says 410): `resolve()` has no 410 and the routing data
  doesn't include tombstones. Adding 410 is a small change to `packages/domain` if you want it.
- **R39. Production wiring is left to gitops** (I must not touch it): the API needs `WEB_DATABASE_URL` (the
  `aiontheballot_web` role's connection, as a `secretKeyRef`), and `PLATFORM_HOST` is optional. The web chart now
  derives `API_URL` from the API service itself. Until the API has the URL, the public site answers 503; until the
  production database has the Spain tenant and its hostname, it answers 404. Done: Dani asked me to make the
  gitops change, and created the tenant.
- **R40. The platform root page is gone;** only the internal tenant route renders, and only a tenant's home until the
  public site arrives (M3). Other tenant paths are 404.
- **R41. The e2e web server binds 0.0.0.0, like the production image:** with `127.0.0.1`, Next treats every tenant
  rewrite as an external one (it renames the host in the proxy's URLs only).

**Coming soon (pulled forward from M3 at Dani's request; branch `coming-soon`):**

- **R42. The tenant home is the coming-soon page, in direction A** (the orange poster on the design canvas), until
  the public site arrives. Everything on it comes from data: the tenant's name, the operator's name, website and
  contact address, and the next public election. Whatever the operator hasn't given is left out, never a
  placeholder. Its wording is provisional, pending the chapter (as for all public wording, M3).
- **R43. Two promises from the mockup were reworded to what the platform guarantees.** "Revisión a cuatro ojos" is
  gone: a platform admin can turn the second reviewer off per election (P14), and the public can't see the setting.
  "Cada valoración enlaza al texto exacto del programa" became "muestra sus fuentes, y cada cita se comprueba contra
  el documento original": a "No lo menciona" rating has no quote, and sources aren't only programmes. The third
  promise is the page history and "last updated", which BRIEF requires on every cell.
- **R44. Not on the page yet:** logos (they come only from brand assets, which have no upload path before M2), the
  methodology link and the legal and privacy links (their pages are M3). The legal notice may be needed before
  then: see Q6.
- **R45. The data comes from a new `GET /public/tenants/{slug}/home`,** read as `aiontheballot_web` like the routing
  data. The web app keeps each tenant's copy for 60 seconds and serves the last good one when the API fails
  (ADR-0003 guardrail 3); on-publish revalidation is M2's. The next election is the soonest one that RLS shows and
  that isn't archived or past, so today only a live one.
- **R46. Colours are semantic tokens by role** (`bg.*`, `fg.*`, `border.*`, `packages/ui/src/brand.ts`), light only:
  a dark mode or a tenant's colours redefine them. A test checks every text colour against each background it may
  sit on; orange is never text on a light background (2.2:1).
- **R47. Fonts are self-hosted** from Fontsource through `next/font/local`, Latin subset only, so no request leaves
  the site (an e2e test checks). Roboto Slab bold waits for the scorecard, since every face is preloaded.
- **R48. The page title is the tenant's name plus "Próximamente",** not `PLATFORM_NAME`, which the admin app still
  uses. The content carries `lang`; `<html lang>` stays `es` until M3 renders it per locale.
- **R49. Seeds:** `ejemplo-a`'s operator now has a website, a contact address and a newsletter, on the reserved
  `.example` TLD; `ejemplo-b`'s has none, so the e2e tests cover both.
- **R50. "Avísame cuando se publique" links to the operator's own newsletter** (button removed by R82; migration
  `organization_newsletter`: `organizations.newsletter_url`, https only, written by platform admins like the rest of
  the row). The platform collects no email addresses, so there is no form, no personal data and no consent to
  manage. For Spain, `~/update-spain-operator.sql` sets the website, contact address and newsletter from pauseai.es
  (a dry run unless piped with `COMMIT`), once this is deployed.

**Announced elections (a change to ADR-0002):**

- **R51. A country admin may announce a draft election,** so the coming-soon page names it and gives its date
  (migration `announced_elections`, `elections.announced`). It widens the public-visibility rule by one row: the
  public sees the announced draft's own row and nothing under it, since every policy below the election checks its
  status itself (a test reads the methodology, reviewers, parties and criteria as the public and finds none). Nobody
  creates an election already announced, an announced election keeps its name in the default locale, and the flag is
  fixed once the election goes live. The other option, a tenant-level "next election" setting, would duplicate the
  election's name and date outside the election. ADR-0002 and the data-model spec are amended.

**Social sharing (Dani's priority):**

- **R52. satori 0.35.1:** the newest release past the workspace's three-day rule (`minimumReleaseAge`); satori
  released 24 times in 30 days. `@resvg/resvg-js` 2.6.2 ships the musl binary the Alpine image needs (checked in a
  locally built image: first fetch 24 ms, then 5 ms).
- **R53. The fonts are embedded in `packages/og` as base64** (`pnpm --filter @aiontheballot/og fonts` regenerates
  them from `packages/og/fonts/`, where their licences are; a test keeps them equal). Next bundles workspace packages
  and resolves file assets differently in pages and in route handlers, so reading font files failed in one or the
  other.
- **R54. A stale image hash redirects with 307 and a minute's cache,** not 301: the current image changes with the
  content. Only the current hash renders, so requests can't make the server render arbitrary pictures. Before
  redirecting, the route refetches the tenant's data (at most once per tenant every 5 seconds), so servers whose
  copies differ in age can't bounce a crawler between two hashes.
- **R57. The hash covers everything drawn:** the card's texts, the size, the palette and the embedded fonts, plus
  `TEMPLATE_VERSION`. A test pins the SVG each version draws, so a template change or a satori upgrade that draws
  differently fails until the version is bumped: a picture never changes under a cached URL. Replaced by R147's
  build-time fingerprints.
- **R58. Metadata is never streamed** (`htmlLimitedBots: /.*/`): Next 16 otherwise puts it in the body for crawlers
  it doesn't recognise, such as Mastodon's and Bluesky's, which read only the head. `og:locale` is set only for the
  tenant's own language (`es_ES`), with no `og:locale:alternate`: the locales are separate pages, as `hreflang`
  says. The renderer loads only when an image renders, so a failure there could never break a page.
- **R55. The coming-soon cards carry no methodology link** (BRIEF invariant 4): there is no methodology page yet.
  Cards for published views will. Without a logo, the operator line is in words (R59).
- **R56. The hero is sized by the viewport's height too,** so on a 1080p screen "Cómo lo haremos" starts above the
  fold (Dani's feedback).

**Logos (tenants' own uploads; Dani's direction):**

- **R59. A tenant's logos are its own uploads** (migration `tenant_brand_uploads`): a brand selection names either a
  platform brand asset, as before, or a file the tenant uploaded into its public assets, like a party logo. Such a
  file is public while an active tenant selects it (ADR-0002, amended); the tenant purge removes selections before
  files. The page shows the operator's logo for orange in the header and for white in the footer, at
  `/brand/{sha256}.{ext}`, cached as immutable; the share cards draw it (PNG or JPEG) and their hash covers it. A
  tenant without logos keeps the operator line in words. Slots: `operator_logo_on_accent`, `_on_canvas`,
  `_on_inverse` and `operator_mark` (and `site_icon`, R72). Brand images are at most 2 MB, as platform assets are,
  and a card draws a logo only if its bytes are the declared format and no side exceeds 4,096 px (a small file can
  declare huge dimensions).
  Accepted consequence: the restricted-asset rule (BRIEF invariant 5) now guards the platform's catalogue only; a
  tenant may upload any image, a copy of a protected logo included, as its own responsibility (ADR-0002 amended).
  An election's slug can never be `brand` or `og`, which these routes take (R76).
- **R60. Uploads made by SQL before M2 record the nil UUID as their author:** no accounts exist yet, and
  `files.created_by` is required. It reads as "the database owner, by SQL"; real users get uuidv7 ids, so it can't
  collide. It also lands in the audit log's actor, where earlier owner scripts left none; a future foreign key from
  `created_by` to users would have to allow it. `~/upload-spain-logos/upload.sh` uploads PauseAI España's logos
  from the brand kit, rendered to PNG (uploads can't be SVG, which can carry script): bytes through `put-file`,
  then rows.
- **R61. File bytes live on a persistent volume, not in Postgres** (Dani's call; migration `files_on_volume`,
  [ADR-0004](adr/0004-file-bytes-on-a-volume.md), ADR-0001 amended). `app.file_blobs` and the brand assets' inline
  bytes are gone; the rows, and every rule about them, stay in the database. A persistent volume (kept on uninstall,
  never pruned) is mounted by the API at `/data`; the store writes each file under its tenant, bucket and SHA-256,
  before its row. The API reads bytes only for a row RLS shows, from that row's own folder. Until the admin uploads
  (M2), `put-file` puts bytes on the volume from stdin. The cluster's backup plan (gitops) must copy the volume, and a
  sweep must remove bytes no row names (R75).

**File storage (fixes after the adversarial review of R61):**

- **R62. Bytes are found by tenant, bucket and hash** (`{tenant_id}/{bucket}/sha256/…`, and `platform/sha256/…` for
  brand assets; Dani's direction). The API takes the folder from the row it read, never from the request. Before, the
  store found bytes by hash alone, so a member of one tenant could record another tenant's private hash (the public can
  read `source_documents.sha256`) and have the brand route serve those bytes. `put-file` takes the folder as
  arguments: `<tenant-id> <public_assets|sources>`, or `platform`.
- **R63. The store checks the hash on every read, and repairs what it would otherwise trust:** a copy already on the
  volume is reused only if its size and hash are right, and replaced otherwise; a write is flushed (`fsync`) before
  its rename and the folder after it. Temporary files older than a day are deleted when the API starts. At startup the
  API also writes a probe file and logs whether the store is writable; a failure is logged and reported, and never
  stops the API: routing and the home data don't need the volume, only brand images do.
- **R64. The migration refuses to run while any bytes are in the database** (`RAISE`, naming the counts), rather than
  my proving that production has none: I can't run SQL there. It locks both tables before counting. It drops
  `file_blobs` and `brand_assets.content` in the same release as the code that stops reading them, which
  CONTRIBUTING's expand/contract rule normally forbids. The guard makes it safe: the old pods' brand-image query names
  what is dropped and would fail, but it runs only for an image the home data names, and with no files and no brand
  assets there is none; their home-data query reads only columns that stay. With rows, the way through is to save
  their bytes, delete the rows, deploy, and put them back with `put-file`. A seeded local database must be recreated
  (CONTRIBUTING).
- **R65. `purge-tenant-files` deletes a purged tenant's folder** (the file half of `purge_tenant`, which SQL can't
  do), only on proof piped from the owner's query: a `purged <tenant-id>` line, printed only for a tenant `purge_log`
  records and that no longer exists. A mistyped id, or an inactive tenant that still exists, gets no line and loses
  nothing (an earlier draft checked only that the public couldn't see the tenant, which an inactive one passes). It
  only reports what it would delete unless given `--delete`.
- **R66. The chart's volume names its class and type explicitly** (defaults `storageClass: local-path` and the PVC
  annotation `volumeType: local`): file-system volume backups copy `local` volumes but not `hostPath` ones, and the
  type can't change once the volume exists. The folder the provisioner creates needn't belong to the app's user; uid
  1000 writes through `fsGroup: 1000`, which the kubelet applies to `local` volumes, now with
  `fsGroupChangePolicy: OnRootMismatch`. Whether deleting the claim by hand keeps the folder is the class's reclaim
  policy (gitops). The class neither enforces nor expands the size the claim asks for.
- **R67. Backups: each volume copy is taken after the database dump it goes with;** the sweep keeps unnamed bytes for at
  least as long as the oldest database dump that could be restored: the backup plan's retention (gitops) plus a week's
  margin for backups that expire late; I propose 120 days, which covers it. Every pod marks its scratch volumes to be
  skipped (`backup.velero.io/backup-volumes-excludes`), so the API's file volume is all a backup copies of the
  namespace. The backup plan (gitops) must copy the namespace on its schedule, after the dump.
- **R68. ADR-0004 records the move.** CLAUDE.md asks for an ADR when the security model changes, and "a stored file is
  what its hash says" left the database for the store. ADR-0002's must-fail item for it now names the store's unit
  tests and the API's database tests.
- **R69. The API has database tests** (`apps/api`, `pnpm test:db`): its data functions run against `aiontheballot_test`
  as the runtime roles, each in a rolled-back transaction, after `@aiontheballot/db`'s tests have rebuilt it (a turbo
  dependency, since those drop and recreate the schemas). They run the cross-tenant attack of R62.
- **R70. Seeds write their bytes on every run,** so a deleted `.data/files` comes back with `pnpm db:seed`.
  `FILES_ROOT` is in `.env.example` commented out: only an absolute path works for the API, the seeds and the tests,
  which run from different folders.

**Site icon (favicon):**

- **R71. The platform's default icon is the coming-soon page's ballot going into the slot of a ballot box, marked
  with the AI sparkle instead of a cross,** on an orange tile: the tile carries the marks' contrast with it (ink on
  orange and on white), so the icon reads on light and dark tabs alike. No text, no tenant's branding. 16 and 32 px
  have their own drawings on the pixel grid (at 16 px the sparkle is seven pixels across and reads more as a bold mark
  than as a sparkle); from 180 px the tile fills the square, since home screens cut their own corners. A test pins
  each drawing, and the URLs' hash covers the drawing itself.
- **R72. A tenant replaces it through a `site_icon` logo slot:** a PNG, used only if a decoder will draw it whole
  (every chunk's checksum; a colour type and bit depth the format allows, which also bounds what inflating costs; a
  palette when it needs one; image data that inflates to what its header says, every row with a known filter: a file
  cut short passes a header check and then draws nothing), square, and 512 to 1,024 pixels a side (512 so every size
  served is a reduction; 1,024 since nothing larger is served and every pixel costs the renderer). The web app decides
  once per upload, by its hash, at startup or on first use, and remembers it for the whole process; the database
  doesn't know an image's dimensions. Anything else, and an icon whose
  bytes can't be read (asked again after a minute), gets the platform's default, never another organization's mark.
  The slot can also take a platform brand asset, like any logo slot, eligibility rules included. Tenant icons are
  scaled down by halving, so fine lines turn grey instead of vanishing, and land on white from 180 px. While an
  upload can't be read, `/favicon.ico` is cached a minute instead of a day.
- **R73. Icons are served by content hash** at `/brand/icon/{size}.{hash}.png` under the tenant's root (16, 32, 180,
  192 and 512), cached a year as immutable; a stale hash redirects (307) like a share image's (R54). Using `/brand/`
  adds no path an election slug could take. `/favicon.ico` holds the 16, 32 and 48 px PNGs and is cached a day with
  an ETag, since its name has no hash. The pages name them through Next's metadata (`icon`, `apple-touch-icon`,
  `shortcut icon`), plus a web manifest (`/manifest.webmanifest`, cached an hour) with the tenant's name and the 192
  and 512 px icons, `display: browser`, so nothing offers to install the site as an app. Rendered icons have their own
  cache, apart from the share images.
- **R74. Seeds:** `ejemplo-a` has a fictional 512 px icon (a white frame on teal); `ejemplo-b` has none, so the e2e
  tests cover both and check the pixels each shows.

**Orphan-bytes sweep (ADR-0004 §5):**

- **R75. `sweep-files` deletes bytes no row names, once no row has named them for 120 days** (never less than R67's
  floor: the backup retention plus a week for backups that expire late). Since when is the later of the last time a
  row stopped naming them (a deleted file row, or a brand asset given other bytes), which the owner's list takes from
  the audit log, and when the sweep first saw them unnamed (a ledger on the volume, for bytes no row ever named), so
  bytes named again and dropped again wait their full time again. A database restore rewinds the audit log; the list
  carries the database's identity (cluster, timeline, database and audit table OIDs: a logical restore or archive
  recovery changes it) and the log's sequence, and when the identity changes or the sequence goes down every clock
  starts again and nothing is deleted that run, `--delete` or not (a restore by crash recovery, such as a volume
  snapshot, changes neither, so the restore runbook must delete the ledger, which starts every clock again just the
  same). It runs by hand, like `put-file`: the owner pipes the list from Postgres (as `postgres`, row security off,
  which the list proves), since no runtime role can read every tenant's files. It refuses a list cut short, stale or
  from the future, a list naming nothing while files are stored, and one naming files the volume lacks; it deletes more
  than half the stored files only with `--allow-many`; it never deletes a file stored or reused within a day of the
  list's snapshot (`put` marks reused bytes, and the sweep moves a file to `retired/` and checks it there, putting back
  what a halted sweep left without ever replacing a fresh copy, and touching nothing through a link); one runs at a
  time, and a purge never runs during one and also clears what a sweep set aside of its tenant. Without `--delete` it
  only records and reports. Scheduling it needs a new grant: D7.

**Reserved election slugs:**

- **R76. An election's slug can never be `brand`, `og` or `healthz`** (migration `reserved_election_slugs`, a check
  on `elections`), since an election's pages live at `/{slug}` and the public site serves those paths itself:
  `healthz` is added to Dani's two because the health probe answers it on every host before routing, so an election
  with that slug would be unreachable (`og`, two letters, is also refused as locale-shaped; it is listed anyway, so the
  list doesn't lean on that rule). The list is `RESERVED_ELECTION_SLUGS` in `packages/domain`; a web test fails
  when a first path segment the public site serves, under the tenant's root or before any tenant (`SYSTEM_PATHS`), is
  neither in it nor something no slug can be (`favicon.ico`), the slug's shape read from `app.slug` in the schema.
  It follows Next's metadata files (`icon.tsx` answers `/icon`, a `sitemap.ts` with `generateSitemaps` `/sitemap/…`),
  route groups, slots and intercepting routes; a metadata file inside a group or slot is always refused, since Next
  adds a hash to its name that no reserved list can hold. The
  public site's own pages (methodology, legal notice and the like) get paths in its spec (M3); each needs adding then,
  or a prefix of its own. Tenant slugs, on the platform host, aren't covered.

**M2 (editorial workflow), slices taken while Dani was away:**

- **R77. The cell editor's live match (W13) is in `packages/domain`** (`matchQuote`), mirroring the database's trigger
  step for step (each page normalised on its own, joined with one space, the first occurrence, 15 characters counted as
  the database counts them), and a database test runs the same quotes through both. When a quote doesn't match, "the
  longest matching part" (C2.6) is the longest start or end of the quote that appears, found by binary search (a few
  dozen searches of the text), rather than the longest common substring of quote and source, which would cost the
  quote's length times the programme's on every keystroke. It shows the editor where the difference begins. It also
  applies the column's limits (15 to 1,000 characters as stored), so it never calls a quote the column refuses a match,
  and says which count fell short (as stored, refused on save; or normalised, saved but never matched). The longest
  matching part is given normalised; the editor will need it mapped back onto the quote as typed. Text Postgres can't
  hold at all (a NUL character) is refused on save as invalid. The API route that serves it, which should keep each
  source's normalised pages rather than redo them per keystroke, waits for sign-in (editorial workflow spec §18, O2).
  The two normalisers still differed on rare characters: D9, fixed by R113.
- **R78. Database refusals become HTTP answers by SQLSTATE** (editorial workflow §2.3): 42501 → 403, 23001, 40001
  and 40P01 → 409 ("reload"), 23514 → 422, 23505 → 409, 23503 → 409 ("linked"), 54000 → 429, invalid values → 400,
  each with a message key in `packages/i18n` (English and Spanish), plus the constraint's name for unique, foreign key
  and check violations so the admin can point at the field. A 42501 from a missing grant (Postgres's `aclcheck_error`,
  not RLS or a trigger) is the API's bug: a 500 to report, like anything else unlisted. The database's own message and
  detail are never passed on: they can quote what was written. 54000 is a limit only when a trigger raised it (the
  reports a site takes in a day); Postgres's own (an index entry too large, from a slug far too long) is a fault, and
  so is any missing grant on a column, type or sequence, or a query RLS would filter with row security off. A deadlock
  answers "reload" but is reported: two writes take locks in different orders. `app.slug` had no length limit: R101
  gives it one. Two gaps for the
  routes that raise them: mapping each trigger's message to its own key, as §2.3 asks; and triggers raise
  `check_violation` without a constraint name (`USING CONSTRAINT`), while a table's CHECK on a value (a reserved
  slug) also answers "incomplete", so the admin words those by constraint.
- **R79. The cell grid (C1.1) is an API data function, `cellGrid`, read in the actor's transaction** (its type asks
  for one), so RLS decides who sees which election, and the tenant in the path picks it (two tenants may share an
  election slug). A cell is _published with a newer draft_ when it is a draft and has a revision; _withdrawn_ shows
  as published without a rating, never as pending; _rejected_, with the reviewer's note, while its latest workflow
  event is a rejection (comments don't count; resubmitting records a newer event); flagged while it has a recheck
  reason. Its route waits for sign-in (editorial workflow spec §18, O2).

**Chart packaging:**

- **R80. The umbrella chart's subcharts are no longer committed** (`helm-charts/aiontheballot/charts/` is ignored). Argo
  CD runs `helm dependency build` when `helm template` finds a chart's dependencies missing, building them from their
  `file://` sources in the same checkout, which it cleans at every new revision; CI does the same before `helm lint`.
  This replaces the vendored `.tgz` files of M0, and the check that they matched their sources, which put a binary diff
  in every chart change. Checked before the switch: clean clones with and without them render the same 13 objects, byte
  for byte, with Helm 4.3 and inside Argo's own image. If Argo ever failed to build them, the application would show a
  ComparisonError (`error building helm chart dependencies`) and neither sync nor prune, so the running version stays;
  to go back, revert, run `helm dependency update helm-charts/aiontheballot` and commit the tarballs (the reverted ones
  may be stale). A subchart's new version still needs `helm dependency update` for `Chart.lock`. Should the application
  ever get a `manifest-generate-paths` annotation, it must include the subcharts' folders, or their changes would go
  unseen.

**Sign-in (M2, O2 decided):**

- **R81. Better Auth's tables are its own, generated for our options and named like ours** (migration `auth_schema`, in
  the `auth` schema only `aiontheballot_auth` reaches). `apps/api/src/auth/schema.ts` maps Better Auth's models to
  plural snake_case tables (`users`, `sessions`, `accounts`, `verifications`, `two_factors`, `rate_limits`), and an API
  database test runs Better Auth's own migration in a rolled-back scratch schema and compares the two catalogs (columns,
  types, defaults, keys with their delete actions, indexes), so options and tables can't drift; it also signs in, enrols
  TOTP and trips the rate limiter as `aiontheballot_auth`. Ids are Better Auth's uuids (`gen_random_uuid()`), not the
  `uuidv7()` of `app` tables: nothing sorts them. The rate limiter counts in the database, so both API replicas share
  it. Name, email, image, a session's address and browser, and the limiter's keys (addresses) are commented
  `personal data`; Better Auth deletes an expired session when it meets it, expired tokens on any lookup and old limiter
  rows itself; a daily job for expired sessions it never meets again comes with sign-in (M2). The connections
  (`createAuthPool`) set `search_path=auth`, so Better Auth's unqualified names find its tables (the role can't create
  in `public`, so a changed path fails closed), and read `bigint` as a number, which the limiter's arithmetic needs.

**Coming-soon page, after Dani's review:**

- **R82. The election's date in full on its own line, the operator line once, and no newsletter button** (Dani's
  choices). A name like "Elecciones generales del 29N" already holds the date in short, so the date follows it as
  "Domingo, 29 de noviembre de 2026" in a `<time>`, capitalised to start the line. "Una iniciativa de" stays only in
  the footer, where M3's shared layout puts it; the page names the operator above the fold anyway. The "Avísame cuando
  se publique" button (R50) is gone: signing up to the operator's general newsletter is not being told when the site
  is out. `organizations.newsletter_url` stays, unused, for M3. A real notify list stores addresses, so it waits for
  the privacy policy (M3) and email sending. The share cards keep "name · date" on one line.
- **R83. Plausible, every feature, behind the site's own host** (Dani's choice: now, not at M3; the full feature set).
  The site serves each tenant's Plausible script at `/_relay/views.js`, fetched from Plausible and kept five minutes
  (a failure is retried after a minute, the last copy served meanwhile), and our bundle runs Plausible's installation
  snippet with `endpoint: '/_relay/views'`, the proxy Plausible documents. So the browser talks to no other host (the
  e2e test that no request leaves the site still holds), there is no inline script for M3's CSP to allow, blockers
  that look for Plausible's host miss it, and time on page, scroll depth, outbound links, downloads and forms all
  work, switched in Plausible's site settings. The relay forwards an event only for a host with a site, only that
  site's (`d`) and about a page of that host (`u`, written as a browser writes it, so the odd address a browser writes
  differently isn't counted), written out again as parsed so a repeated key can't mean something else to Plausible. It
  refuses a browser's event from another site, caps the body, and passes on the browser and the visitor's public
  address: the last `X-Forwarded-For` entry, the one the gateway adds after dropping any the client sent. Private,
  loopback and carrier-grade NAT addresses are not visitors: Next fills in the socket's when nothing set the header,
  and every such view would be one visitor, so those are not sent (a preview seen from a private network isn't
  counted either). Plausible hashes the address and browser with a daily salt, stores neither, and derives
  countries from the address; the privacy policy (M3) must say so. ADR-0003 §7 describes this relay beside the error
  relay. The tenant page loads the script, not the root layout, so a 404 is not a page view; once M3 navigates
  client-side, the script's own capture would count a soft navigation to a missing page, so M3 should turn
  `autoCapturePageviews` off and send page views from its pages. Configuration: `PLAUSIBLE_URL`, an address that reaches
  Plausible directly, not its public host (the public gateway drops `X-Forwarded-For`, so every visitor would be one),
  and `PLAUSIBLE_SITES`, a JSON object from each tenant host to its site's `pa-….js` script (since R135, each site's
  script in its settings, on its canonical host); the Plausible site must be named after the host (the platform host
  would put every tenant served by path into one site). A malformed configuration, or events naming another site, count
  nothing and say so in the log, at most once a minute, as do Plausible's failures (5xx, 429, no answer), with nothing
  of the visitor's. The script runs on our origin, so it is Plausible's code, from our own server, with the page's
  privileges; the public site has no session or cookie to reach. Unit tests cover the configuration, the relay and the
  script's caching, an e2e test follows a stand-in script's view to a fake Plausible, and Plausible's real script was
  checked once to send to the relay with our loader.

**Sign-in, slices 3b and 3c (M2; editorial workflow A4, ADR-0003 §2):**

- **R84. A session is aal2 only if a second factor created it** (migration `auth_session_aal`, `auth.sessions.aal`).
  Better Auth's database hook writes 2 when `/two-factor/verify-totp` or `/two-factor/verify-backup-code` creates the
  session, and 1 for any other (the password-only one a new account enrols with); the API acts at aal2 only for an aal2
  session of a user with TOTP, and gives every other session no actor at all. Options: derive the level from
  `users.two_factor_enabled` (a session a password opened before its user enrolled, in another browser, would become
  aal2 without ever giving a code); revoke the other sessions at enrolment (racy against a concurrent sign-in). The
  column is what Better Auth creates for the field (no default; the migration's default only fills existing rows), and
  the catalog test compares it. ADR-0002 §3 and §9 now say so.
- **R85. Only the endpoints the admin uses are reachable, with only their fields** (`apps/api/src/auth/routes.ts`):
  `sign-in/email` (email, password), `sign-out`, `two-factor/enable` (password), `two-factor/verify-totp` and
  `verify-backup-code` (code), and `reset-password` (token, newPassword; R93). Everything else under `/api/auth` answers
  404 (sign-up, turning TOTP off, password changes, asking for a reset link, Better Auth's own `get-session`, and
  whatever an upgrade adds), and only JSON bodies are taken (415 otherwise, `text/plain` included, which Fastify would
  otherwise parse), so a cross-site form can't post. Dropped fields: `rememberMe` (false would make a 24-hour session),
  `trustDevice` (skips TOTP for 30 days), `callbackURL`, the enrolment's `issuer` and `method`. The session token Better
  Auth also puts in response bodies is removed: it lives in the `HttpOnly` cookie only. Sign-up is also off in Better
  Auth's options, and passwords need 12 characters there, which applies when one is set (R93's link; invitations and
  resets later).
- **R86. `/api` answers only on the admin host** (404 for any other `Host`, before Better Auth sees the request), behind
  the gateway, which routes `/api` only there: a route added to a public host by mistake still reaches nothing. The
  admin's server calls the API inside the cluster with the `Host` and cookie the browser sent it and nothing else, over
  `node:http` (fetch can't set `Host`), so a page served on any other host finds no session. The origin comes from
  `ADMIN_ORIGIN` (https, or http on a loopback host); sign-in needs it, `AUTH_DATABASE_URL`, `BETTER_AUTH_SECRET` (32
  characters or more) and `PLATFORM_NAME`, all or none: some without the others fails the chart's rendering (and would
  stop the API at startup), and none leaves `/api` answering 503, which the admin shows as "signing in isn't available
  yet" (as it does a 404, during a rollout).
- **R87. Cookies and sessions:** every Better Auth cookie is `__Host-admin.*` (better-call also forces `Secure`,
  `Path=/` and no `Domain` on that prefix), `HttpOnly`, `SameSite=Lax`. The session lasts 12 hours from sign-in in a
  cookie of the same age, and is never extended (`disableSessionRefresh`; Better Auth's default refresh age, a day,
  would not reach a 12-hour session anyway, so that test also passes without the option: an equivalent mutant). The
  cookie that holds a sign-in between the password and the code lasts 10 minutes.
- **R88. Rate limiting is Better Auth's, in the database, with its default rules:** per address and endpoint, three
  sign-ins and three two-factor calls every ten seconds, 100 of anything else. The address is the last `X-Forwarded-For`
  entry (the gateway's, as R83 reads it), else the connection's own (so a request with none still shares a bucket
  instead of escaping); IPv6 counts per /64. The API writes it into a header of its own that Better Auth reads,
  replacing whatever a client sent. Better Auth adds per sign-in five tries at a code, and per account a 15-minute lock
  after ten wrong codes in a row. Accepted for now, in the brief: no per-account limit on wrong passwords (the limit is
  per address), and a TOTP code can be used twice within its 30 seconds (Better Auth keeps no record of used codes).
- **R89. The TOTP issuer is `PLATFORM_NAME`,** what the admin's title already shows, so the API now needs it too (the
  chart's `platformName`).
- **R90. The daily clean-up is a CronJob from the API's image** (`delete-expired-sessions.js`, 03:17 UTC), as
  `aiontheballot_auth` with no other credential: expired sessions, expired verification values (pending second factors),
  and rate-limit rows a day past their last request. Not the API's process (ADR-0003 guardrail 1) and not the worker,
  which doesn't exist yet and must never reach `auth`. It needs no new grant (the role could already delete); ADR-0002
  §2 names it as the role's second user. Rendered once the chart has the role's secret; it takes none of the API's
  environment, only its own (`auth.cleanup.envFrom`, for the error-tracking DSN). It peaks at about 110 MiB, so it asks
  for 128 MiB and may use 256.
- **R91. The first signed-in routes:** `GET /api/session` says where a request stands (`signed-in`, `enrol`, `challenge`
  or `signed-out`, with the user's id, name and email, never the session) for the admin's pages to choose, and `GET
/api/tenants` lists the tenants RLS shows (A6), proving that aal2 reaches the database: a session short of it gets 401
  before any query, and the same membership read at aal1 gives nothing (mutation-checked).
- **R92. The admin's screens** (sign-in, TOTP challenge with a backup-code alternative, enrolment, and a signed-in home
  listing the user's tenants) post from the browser straight to `/api/auth`, so cookies never pass through the admin's
  server; server components only send each request to its stage's page. Language from `Accept-Language` (English when
  neither is asked for, the source language; a switch can follow). Ark UI 5.39.3 (`Field`, `QrCode`), errors in a
  `role="alert"` region marked in words; enrolment's steps move focus to their heading; the QR code is an image with a
  label, with its key as text; pages are `noindex`. Inputs name the form's error in `aria-describedby`, and a busy
  button is `aria-disabled`, not disabled, so focus stays on it. A password-only session can sign out from enrolment or
  sign in again as someone else, and a challenge links back to sign-in. Backup codes are shown after the code, as A4.3
  says, so a reload at that step loses them: regenerating them needs a screen of its own (Better Auth has the endpoint).
  The e2e tests run through a stand-in gateway (`e2e/fake-gateway.ts`: `/api` to the API, Host kept, `X-Forwarded-For`
  appended), so cookies, origins and the limiter's address work as in production; each test plays its own visitor
  through a test-only header the stand-in honours, and creates its own account straight in Better Auth's tables, since
  sign-up is closed.

- **R93. The first account (editorial workflow A1), with no owner credentials in any code:** `create-account.js`, run in
  an API pod with `kubectl exec -it` (never `kubectl run`, whose output the pod's log would keep), asks for the email
  and name (so neither is in the command line, nor in the cluster's audit log of it) and creates the account as
  `aiontheballot_auth`, like Better Auth itself: email verified (checked with Better Auth's own rule first, so it never
  makes an account that can't sign in), no password, no TOTP, no role. It prints a single-use link, valid for an hour,
  to the admin's new set-password page, and the SQL that makes the account a platform admin (no runtime role can write
  `app.platform_admins`; the spec had the command do it with the owner's connection), written so it adds nothing until
  the account has enrolled TOTP. For an account that exists but never set a password it prints a new link, which ends
  any earlier one; any other existing account is refused; an account it couldn't make a link for is deleted again (a
  path no test reaches). The token is in the link's fragment (`#token=…`), which browsers send to no server, so it stays
  out of the gateway's and the admin's logs, error reports and Referer headers; the page, rendered in the browser only,
  reads it (also when the link is pasted into the page already open), takes it out of the address bar and the
  back/forward list (not the browser's global history), and posts it to Better Auth's `/reset-password`, now on the
  allowlist with `token` and `newPassword` only. Better Auth keeps these tokens as SHA-256 hashes (`storeIdentifier` for
  `reset-password:`). Nothing reachable asks for such a link, so no reset email exists yet. Setting a password ends all
  the account's sessions (A5.3) and spends its other links; a short one is refused without spending the link. Equivalent
  mutants: Better Auth's default expiry is also an hour, and it lowercases emails itself. Error reports now also lose
  the query and fragment of every URL- or path-like context field and tag (Next's `contexts.nextjs.request_path` kept
  the query) and of stack frames' file names. Invitations (A3) will reuse the page.

**M2 admin screens: choosing a site and its members (editorial workflow A6, A7):**

- **R94. Members' names and emails are read from Better Auth's tables, as `aiontheballot_auth`, by id, for exactly the
  memberships RLS showed the actor** (`apps/api/src/admin/profiles.ts`). They live only in `auth.users`, which
  `aiontheballot_admin` can't reach (ADR-0002 §2), so the members route reads the tenant's memberships in the actor's
  `withActor` transaction and then the names (and emails) of those accounts and nothing else. Every member sees names
  and roles; emails go only to the tenant's country admins and platform admins (A7.1, W18: an API rule, which the
  spec places there), decided from the actor's own memberships and `platform_admins` row as RLS shows them. No new
  grant, function or role: the API already holds that pool, and a compromised API could read the table anyway (T23).
  Options: a `SECURITY DEFINER` function returning a tenant's member profiles (a new allowlist entry); copying names
  into an `app` table (personal data in two places, kept in sync). ADR-0002 §2's role table now names this use. An
  account deleted from `auth` keeps its memberships (no foreign key across the schemas) and shows as "Deleted account",
  its roles still removable. The audit view's actor names (H3.3) can reuse it.
- **R95. The last country admin is refused by the API, under a lock** (A7.4, W7). A removal first locks the tenant's
  row `FOR NO KEY UPDATE`, which RLS lets only country admins and platform admins take (the tenants update policy),
  then counts the tenant's other country admins, and refuses with `409 lastCountryAdmin` if there are none; only then
  does it delete. Counting before the delete matters: a country admin who removes their own only role sees no
  membership of the tenant afterwards, so a count after it would always refuse them (the adversarial review's find).
  Without the lock, two removals at once would each still see the other's country admin and leave none; database
  tests run that race for a platform admin removing both and for two country admins removing each other, and fail
  without the lock. Platform admins are refused too; they add another country admin first (A7.2's direct grant, R96).
  `NO KEY`, so it never blocks writes that only reference the tenant. A membership whose account was deleted still
  counts as a country admin (the database can't tell; the platform admin can still manage such a site). The admin
  hides the only country admin's Remove button and says why; the API is what refuses.
- **R96. Giving an existing member another role is direct** (A7.2), offered to country admins and platform admins
  for members of the tenant only; anyone else needs an invitation (D10). The database's insert policy would accept any
  account id; restricting it to members is the API's rule, as the spec says. A role already held is the membership's
  key (`409 taken`).
- **R97. The admin writes from the browser straight to `/api`, as JSON, and the API takes a write only with the admin's
  `Origin`** (`apps/api/src/admin/routes.ts`), as the sign-in forms already do (R92): reads stay in server components
  with the browser's cookie. Browsers send `Origin` on every non-GET request, so with `SameSite=Lax` cookies and
  JSON-only bodies this is a third, explicit barrier to cross-site writes. Each route runs one `withActor`
  transaction; a refusal, the database's (R78) or the API's own (`notFound`, `lastCountryAdmin`, `notMember`), is a
  key the admin words in English and Spanish, and anything else is a 500 reported with its SQLSTATE and routine only,
  never the database's message. A tenant RLS hides answers 404, the same as one that doesn't exist; so does a malformed
  slug in the admin (400 from the API).
- **R98. Landing and the shell** (A6). After sign-in, a member of exactly one site goes to its dashboard; several
  sites, or a platform admin, the list (`/`), which the empty-handed also see. Every tenant screen sits in one shell:
  the platform's name, the site's name, a site switcher (an Ark UI menu of links plus "All sites", shown only when there
  is somewhere else to go), the account, and the site's sections, the current one marked by `aria-current`, a thick
  underline and bold text; a skip link leads past them. The admin keeps calling tenants "sites" (R92's wording). Tenant
  content in a language other than the page's carries its own `lang` (WCAG 3.1.2). The dashboard says what the user
  holds there and whether the site is public; the work queues of C1.2 wait for cell editing. Removing one's own last
  role in a site leads to the site list (a platform admin stays). After a change, focus moves to the status line that
  announces it, since the button pressed may be gone.

**M2 admin screens: tenant settings and policy texts (editorial workflow §5, P1):**

- **R99. Policy texts: one draft per kind, saved or published in one statement, shown as written** (T2). Starting a
  version while the kind has a draft is refused (`409 draftExists`), so no draft is forgotten beside another; two
  started at once run one after the other under R95's lock on the tenant's row (which only those who write texts can
  take), so the second finds the first (a database test races them; the adversarial review found the version key alone
  let a second draft in). Publishing without the default language is refused naming it (`422
needsDefaultLanguage`), and the admin opens that language's tab. A new version's form starts as a copy of the latest
  published one (T2.2, in the admin), and "Publish" saves the text and publishes it in one `UPDATE` (or `INSERT`), so
  what is published is exactly what the form showed; the trigger still requires the default language and stamps the
  time. A published version, or one that is gone, answers `409 stale` or `404` rather than a silent no-op. The admin
  shows texts as written (line breaks kept, nothing rendered): Markdown is rendered, sanitized, on the public site
  (M3), so the admin runs no Markdown at all. Each language takes at most 100,000 characters (an API limit, well inside
  the 1 MiB body limit). Localized input everywhere (`localized-input.ts`) takes only the tenant's languages (another
  is `400`), drops blank entries, which the column refuses, and is `422 incomplete` when nothing is left. Fields are
  one tab per language, the default first and marked "needed to publish" (§2.4), each input carrying its `lang`.
- **R100. Settings: report retention for country admins, the second approver for platform admins, both shown to all**
  (T3, P1.1, P1.3). Retention takes whole days from 1 to 36,500 (the column takes any positive integer; the cap only
  keeps a typo from keeping reports for ever), and the screen says a change applies to reports sent from then on. Whether
  live edits need a second approver is a checkbox only platform admins get; everyone else sees it in words with who may
  change it, and the database refuses anyone else (`members_may_change`, 403). A body with nothing the route knows is
  `400`, since Fastify drops unknown properties. Not built here: theme colours, whose names are the public site's spec's
  (T1.2, M3), and logos and the site icon, which need uploads to the file volume (T1.3–T1.5). The election's four-eyes
  setting (P1) is on the election's screen.

**M2 admin screens: elections and their structure (editorial workflow §6, P1):**

- **R101. Slugs stop at 63 characters** (migration `slug_length`, a check on the `app.slug` domain, so tenants,
  elections, parties and criteria alike), as R78 asked before editors write slugs: a DNS label's length, what the API's
  routes already took for a tenant's slug. Without it a slug long enough passed the check and then failed in its unique
  index, a fault rather than a refusal. The migration validates every stored slug first, so it fails, changing nothing,
  if one is longer. The API test that provoked Postgres's own index limit through a long slug now does it through a
  brand slot's name.
- **R102. Report retention stops at a century in the database too** (migration `report_retention_cap`, from the
  adversarial review of R100): `submit_report` adds it to the day a report arrives, and a value past the date range
  would have made every public report fail. 36,500 days, the API's limit (R100).
- **R103. Election screens: the list and the form at `/t/{tenant}/elections`, each election under
  `/t/{tenant}/e/{slug}`** (§2.1), with its own sections (overview, methodology, parties, criteria) and a notice saying
  what its status allows. Slugs and territory codes are sent as typed and judged by the database, whose constraint names
  the field (R78): the forms word each (`elections_slug_check`, `slug_length`, `elections_tenant_id_slug_key`, and so
  on). The territory is asked as the subdivision after the tenant's country code, which is shown; a trigger's refusal
  of a country names no constraint, so it is worded generally. A date is a day (`YYYY-MM-DD`, read as text, never as an
  instant). Renaming a slug moves the page to its new address. Creating needs editors, country admins or platform
  admins; the column grants make it a draft, unannounced, with four-eyes on (E1.1).
- **R104. Parties and criteria: added at the end, ordered with Up and Down buttons, edited on a page of their own**
  (E4). A move sends the order the page showed and the new one; if the list isn't in the order shown (someone added,
  removed or moved one meanwhile) it is `409 stale`. The list's rows are locked first, by id, so two moves at once run
  one after the other instead of deadlocking, and one statement renumbers only the rows that moved (the adversarial
  review found the row-by-row version could deadlock). Two parties added at once may share a display order, which the
  next move resolves. Focus follows the moved item to the button it can still use. Drag and drop isn't built: the
  buttons give keyboard order (E4.5), and drag can come with the cut list's admin polish. A party's colour is a colour
  input with "No colour"; territories are typed as codes, normalized to upper case and deduplicated; empty website and
  territories are none. A criterion's short title is optional until going live, and its field is no wider than the
  column it heads (W22). Not built here: party logos (uploads), programme status (§9, which needs sources) and retiring
  through change requests (CR1).
- **R105. The methodology is created on its first save, in the tenant's kind**, which is shown and not chosen (E2.1); a
  demands one names the operator or an endorser, offered from the tenant's organizations. Its source kinds default to
  PDFs and web pages (Q9); each kind says how many quotes and checked documents use it, and unticking one in use warns,
  in a live region the checkbox names, how many quotes (or checked documents) it leaves unsubmittable (E2.5). External
  reviewers need a confirmation that the person agreed to be named, which isn't stored (W10); names are trimmed and
  refused blank. A reviewer can't be added before the methodology exists (`409 noMethodology`).
- **R106. The overview: details for editors, the announcement for country admins, four-eyes for platform admins** (E1.3,
  R51, P1). Turning four-eyes off asks first and says that one person may then publish their own work, recorded
  privately as self-reviewed (P1.2); turning it on doesn't ask, and Cancel leaves the checkbox showing it on. Each
  form's button names what it saves. Country admins delete a draft election once nothing refers to it (E8): the
  database's foreign key answers `409 linked`, worded as what to delete first. Live and archived elections show their
  fields read-only; change requests (CR1) have screens still to build. A change that removes the control that made it
  (deleting a reviewer, the methodology, going live, archiving) is announced in the page's own status line, which
  outlives the reload, and focus moves there.
- **R107. Going live, the freeze window and archiving** (E5–E7), for country admins and platform admins. The overview of
  a draft lists what going live needs, each item done or missing in words and with a sign (an active site, an
  operator, a methodology, and default-language text for the election's name, the methodology, every party's names and
  every criterion's title, short title and description, naming the slugs that lack it), read under RLS
  (`GET …/checklist`) as `election_rules` and `short_title_rules` will check it; and what it only warns about (no
  parties, no criteria, no external reviewers, unpublished policy texts: W9, O3). The button appears once nothing is
  missing, and the dialog asks for the election's slug, typed (E5.4); the database decides again. A live election takes
  a freeze window, from a start to an end or until cleared, entered in the browser's time and sent as instants; every
  election screen shows it while it is on or about to be, in UTC, said so. Archiving asks first and says what stays
  possible, and isn't offered while a freeze window is set and not over: an archived election can't be changed, so the
  window could never be cleared, and the publish trigger applies it whatever the status, so the corrections and
  withdrawals archiving promises would stay frozen (the adversarial review's find; whether the database should refuse
  it is D11). A freeze is taken only as an ISO 8601 instant with its offset, never `infinity` or a year JavaScript can't
  read back. The status only moves forward, as the database allows.

**M2 admin: its language (Dani's request: English by default, Spanish too):**

- **R108. A language switch at the foot of every admin page,** over the browser's language that the admin already
  followed (R92; every screen's words come from `packages/i18n`, English as the source and Spanish required by the type
  check). The choice is a cookie on the admin host only, `__Host-locale` (Secure, `Path=/`, no `Domain`, HttpOnly,
  `SameSite=Lax`, a year; outside Better Auth's `__Host-admin.*` names), set by a plain form posting to the admin's own
  `/locale`. That works before scripts load and goes back to the page it came from; with scripts, the form posts in the
  background and the page redraws in place (`router.refresh`), so what was typed stays, including the set-password
  link's token, which only the page holds (R93), and focus moves to the language now in use; if that post fails, the
  plain form posts after all, so the browser shows what went wrong. The switch, and its footer, are left off
  enrolment, where a reload would lose the secret and the backup codes shown once (R92). Each language is named in
  itself and marked as written in it, and the one in use is also said in words. Without a choice, the browser's
  language decides, and English when it asks for neither. Another language is a new messages file plus its name in
  `LOCALE_NAMES`.
  - `/locale` takes posts from the admin's own pages only (`Sec-Fetch-Site: same-origin`, or, from a browser without
    Fetch Metadata, an `Origin` that is this host), as a URL-encoded form of at most 4 KB, read with a cap. The page to
    go back to must be a path made of a path's own characters and well-formed escapes, at most 2 KB: a browser drops
    tabs and newlines from a `Location` and reads `\` as `/`, so a looser check could send someone to
    `//another-host`. The cookie is a preference that grants nothing; the public site still sets no cookie.

**M2 decisions Dani took after the run:**

- **R109. No archiving inside a freeze window** (D11; migration `archive_outside_freeze`, in `election_rules`). An
  election goes from live to archived only once its freeze window is over or cleared, which the same statement may
  do; a window that is open-ended, still running or still to come is refused (`23001`, "reload", like the other freeze
  refusals: after a reload the admin says to clear the window first). Archived, an election stays public and keeps
  taking corrections and withdrawals, which a window could otherwise hold back for good, since an archived election
  can't change its window. The admin already asked for this (R107); now the database decides.
- **R110. R94 stands as an amendment of ADR-0002 §2,** not a new ADR: it uses Better Auth's existing role and pool,
  with no new role, grant or function.
- **R111. Creating a site gets a screen later** (revisits W6). Dani wants to create sites without a runbook, a demo
  site with fictional data among them. Planned for platform admins after the organizations screens; the hostname
  stays a gitops change. Built: R129, with the demo content as R130.
- **R113. The two quote normalisers follow the same Unicode rules** (D9). One forward migration puts the database's
  quote-matching regexes under `COLLATE "pg_c_utf8"` (Postgres's own Unicode classes, no longer the OS's glibc, which an
  image update could change silently); the live match (R77) uses `\p{Alphabetic}` and `\p{White_Space}` to match; both
  drop U+FEFF (which copying from a PDF or Word brings in); the parity test covers these characters on both sides; and
  a check confirms no stored match would change. To build before the cell editor's UI.
  _Built:_ migration `quote_normaliser_unicode` and `normalizeForMatch` (`\p{Alphabetic}`, `\p{White_Space}`: JS's
  `\s` took U+FEFF and missed U+0085). The migration first normalises every stored source text and quote both ways and
  stops if any would change, since a generated column keeps what it stored (texts and quotes are locked meanwhile, so
  none written during the migration escapes it); guard tests prove it stops for a text and for a quote. The parity
  test adds U+FEFF, U+0085 (alone and around a broken word), U+2028, U+200B, U+180E, tabs and form feeds, every folded
  quote and dash, and a letter that is Alphabetic but no `\p{L}` (U+0345) before a broken word. If the check ever
  stops a deploy, the way on is to recompute the column, which Postgres 17 and later do with
  `ALTER TABLE app.source_texts ALTER COLUMN normalized SET EXPRESSION AS (private.normalize_for_match(body))`, and to
  check again the match of the quotes from the texts it changed. Known drift: Node 26 has Unicode 17 and Postgres 18
  Unicode 16, so for the characters Unicode 17 added the live match can disagree with the database, which decides.
- **R114. Invitations for people without an account use one narrow lookup** (D10). `private.pending_invitation(token)`,
  a `SECURITY DEFINER` function executable by `aiontheballot_admin` only, with an empty `search_path`, returns the email
  and role of a pending, unexpired invitation whose `token_hash` is the token's SHA-256, and nothing otherwise. The API
  creates the account as Better Auth's role with that email verified (following the link proves it) and the person's
  password, signs it in, and `private.accept_invitation(token)` adds the membership at aal1 (W3; nothing until TOTP).
  The token travels in the link's fragment (as R93's), the acceptance endpoint is rate-limited, the token is never
  logged, and one generic message covers every refused link. An ADR-0002 amendment, written when it is built.
  _Built:_ migration `invitation_acceptance`, ADR-0002 §6 and §10 amended. Both functions take the token's SHA-256,
  not the token, so it never reaches the database. The acceptance page (`/invitation`, the token read from the
  fragment and taken out of the address bar) says what is offered; for a new address it takes a name and a password
  (12 characters at least, as Better Auth counts them), and the API makes the account and accepts at once, then sends
  the person to sign in, where TOTP enrolment follows: it doesn't sign them in itself, which would mean relaying
  Better Auth's cookies from a second endpoint. An address that has an account signs in first and accepts with a
  button. Lookups and acceptances share a limit of 20 per visitor per 10 minutes; an unknown, spent, revoked or
  expired token gets the same 404. Country admins and platform admins invite from the members page (A2): a pending
  invitation for the same address and role is revoked by the new one, someone who holds the role already is refused,
  and an email that can't be sent revokes the new invitation again (502), the earlier one still working: the earlier
  one is revoked only once the new one went out. They revoke pending invitations and delete decided ones. The email
  goes through the platform's sender (R115), on the site's behalf: from its operator's name, replies to its contact
  address, in the site's main language; the inviter's name in it is cut to one plain line without links. Only
  country admins and platform admins get as far as looking up an address (so nobody else learns who holds a role),
  each may send 50 a day (per API replica), and an address Better Auth would refuse gets none. Signed in as another
  account, the page says so (409 `otherAccount`) rather than offer a form that can't work. Passwords are 12 to 128
  characters on every path (Better Auth's maximum, now set explicitly). A fault while accepting removes the account
  just made, and is logged by its error class only, never with the address. Mutation check: every rule killed but
  `accept_invitation`'s early return for no actor, an equivalent mutant (the email check that follows refuses it
  too). Changed after an adversarial review, which found no takeover or escalation.
- **R115. Email: one platform sender now, each organization's own later** (decided with Dani). Everything goes through
  the platform's SMTP account. Account mail (password resets) comes from the platform; mail on a site's behalf
  (invitations, later report answers) shows the operator's name as the sender and replies go to its contact email
  (R112). An organization's own mail server, which means keeping its credentials, waits until one asks, with its own
  ADR. The sending credentials are a gitops secret, Dani's step.
- **R116. The worker opens untrusted files in a sandbox, with only the one file** (D8). It never mounts the file volume:
  the API hands it the bytes of its job's file, and it returns the extracted text through its job's row. Around that,
  the usual boxing-in for a parser of hostile documents (OWASP's file-upload guidance): no secret beyond its own
  database login (already limited to the one job it runs), not root, a read-only root filesystem, hard memory, CPU and
  time limits so a decompression bomb or an endless loop kills only that job, no network but the database and the API
  (a NetworkPolicy, which may be a gitops change), and extracted text treated as untrusted wherever it is shown.
- **R117. A scheduled sweep for orphaned bytes, with one narrow permission** (D7). A CronJob from the API's image, not
  the worker (R116), with its own login role that owns nothing and may only execute one `SECURITY DEFINER` function
  returning the file keys still in use and when the others were deleted; it mounts the volume as the API does and
  deletes the bytes nothing points to (R75's sweep, unattended). An ADR-0002 amendment (a new role and function),
  written when it is built, with file uploads; until then the sweep stays manual.
- **R118. Migrations are rehearsed on a copy of a backup, and launch is tested on production at a quiet hour** (D6).
  A script (`scripts/rehearse-migrations.sh`, to write) restores the latest `pg_dump -Fc` into a throwaway database
  in the local Postgres (`pnpm db:up`, production's roles), without the rows that hold credentials or personal data
  (Better Auth's tables, emails), applies the new migrations, runs the catalog checks, prints the result and drops
  the database; Dani runs it before risky releases and the preview, which also proves a backup restores (ADR-0001).
  The M5 load test and the CDN-proxy contingency test run against production before launch. No staging.
- **Backups come from the cluster's backup plan** (gitops, Dani's side): ADR-0001's `pg_dump -Fc` dumps and off-node
  copies must be in place before the preview at the latest. A migration can be undone only by restoring a dump; R118
  rehearses on a dump from the plan, or on a manual dump taken for the purpose.
- **R119. "Let me know when it's ready": the site's own signup list, not an outside newsletter service** (decided with
  Dani). On the coming-soon page, per site: an email field, a consent line linking to the privacy policy, and an
  optional, unticked box "also tell me about future elections on this site". The form says that a confirmation email
  follows (double opt-in, the AEPD's recommended proof of consent) and what happens to the address. Unconfirmed
  addresses are deleted after 7 days. At launch, one email goes out in the operator's name (R115) with a one-click
  unsubscribe; then every address without the future-elections box is deleted (storage limitation: the purpose is
  done), and the others stay until they unsubscribe, for the next election's announcement. The public site gets three
  narrow `SECURITY DEFINER` functions, to sign up, confirm and unsubscribe (tokens stored as SHA-256, rate-limited),
  like `submit_report`: an ADR-0002 amendment, approved, written when built. Country admins see only counts and a
  "send the announcement" action, never the addresses. The form appears only once the site has a published privacy
  policy, which says the same (the operator's text, written in the admin).

**M2 platform screens:**

- **R112. Organizations, on the platform's own screens** (P2, §13.15): `/platform` and `/platform/organizations`
  (the list with the sites each serves, a new one, and each one's page), linked from the site list for platform admins
  only. Anyone else gets a 404 from the layout and from the API, as for a page they can't open; writes stay RLS's to
  refuse. A form writes every field at once (`PUT`): trimmed, blank as unset, emails in lowercase (their checks
  require it); the database checks the emails' shape and the `https://` links, and the form points at the field a
  constraint names. A refusal without one is the API's (a blank legal name or name) or, when the box was unticked, the
  trigger that keeps restricted brand assets to PauseAI chapters, so the form points at that field and says why. A new
  organization opens on its own page, which says it was saved: the page's announcer can now carry a message across the
  navigation the write starts (`announce(…, { afterNavigation: true })`), since the form's own status line goes with the
  old page. The name may be in any
  site's language and any it already has, none required on its own. Not yet: the logo (uploads), linking endorsers to
  a site (P2.3), and deleting an organization.

**Towards the preview (Dani's task list after R119):**

- **R120. Pull requests run CI on GitHub-hosted runners; Renovate opens one non-major PR a week** (Dani's decision,
  ADR-0001 amended). Every `pull_request` job runs on `ubuntu-24.04` (amd64, the platform the images are built
  for), named rather than `ubuntu-latest` so a new Ubuntu release is a commit; pushes to `main` and manual runs stay on
  the self-hosted runner, which the release needs for the registry. Each job picks its runner with one expression on the
  event (`runs-on` can't read `env`); the Renovate changeset job only ever runs on pull requests, so it names the hosted
  runner outright and keeps its write token. Every job PRs ran before still runs, with the same timeouts until a hosted
  run shows they're short; a hosted run installs dependencies from scratch. Renovate: one group for patch, pin, minor,
  digest and pin-digest updates (with `rebaseWhen` repeated in it, since Renovate's defaults for pins would override the
  top-level one); the window is `* 0-5 * * 1` in Europe/Madrid, six hours, wider than the `schedule:weekly` preset's
  four, since the hosted app runs an active repository about every four hours; `updateNotScheduled: false`, so open PRs
  change only in the window too (a conflicted one waits for it, or for the dependency dashboard); `prHourlyLimit: 0`,
  since the default of two an hour could hold a major or the lock-file PR back a whole week; `rebaseWhen: conflicted`.
  Security PRs ignore the window, which a config can't change, though for npm packages pnpm's own 3-day minimum
  (`pnpm-workspace.yaml`) may still refuse a fix younger than that in the lockfile. Lock-file maintenance keeps its own
  weekly PR (`config:best-practices`), since Renovate can't group it with other updates. From the adversarial review. To
  verify on the next Renovate PR's run.
- **R121. The public site's spec, written where the plan left it open** ([spec/public-site.md](spec/public-site.md)). A
  site is _coming soon_ until `OPEN_SITES` (the web app's environment, gitops) lists its slug (since R135, a platform
  admin's switch in the admin), the Preview go/no-go's switch, then with no schema change; coming soon, it serves only
  its home and the always-on pages. The preview host, `PREVIEW_HOST`, serves `/{slug}/…` for every tenant as if open,
  never redirected to a canonical host and never indexed (`X-Robots-Tag` and the robots meta tag); its route belongs on
  a private gateway (a gitops step). The proxy tells pages the mode and their root in request headers it always sets
  itself, over whatever a client sent. Only live and archived elections are public, so going live shows an election's
  parties and criteria on the preview host first, while the public addresses stay coming soon. Paths use the words of
  the tenant's default locale in every locale (`/aviso-legal`, `/en/aviso-legal`), mapped in `resolve()` onto the app's
  English routes; an English word on a Spanish site is a 404, so a page has one address. Every language's tenant-level
  words are reserved election slugs (migration `reserved_site_paths`; `RESERVED_ELECTION_SLUGS` follows `SITE_WORDS`).
- **R122. The signup list (R119), as built** (migration `signups`, ADR-0002 §6, §7 and the data model amended, threat
  T27, then hardened after two adversarial reviews). `app.sign_up` counts and checks the site's daily cap first, for
  every signup alike: 1,000 a UTC day, whatever comes of them, in a per-day counter whose lock also makes a site's
  signups take turns; only then does it look at the address, so neither the cap's answer nor the count tells anyone
  who is listed. A confirmed address changes nothing; otherwise a mailbox (the address without its `+tag`, and a Gmail
  one without its dots, on one domain, so variants count as one) gets an email at most every 10 minutes and 5 times in
  all. Other providers' variants (subdomain addressing, catch-alls) aren't folded: the cap bounds them. The API
  normalises an address first (trimmed, Unicode NFC, lowercase, the domain in punycode, no control or formatting
  character, no port, escape or numeric domain) and answers before the email goes out, so the answer never says
  whether one was sent and never waits on the mail server; a refused address answers a millisecond or so sooner than
  a new one, which an attacker can sample once per address every 10 minutes. A token acts only on
  its own site's list. The token that confirms then unsubscribes, and unsubscribing deletes the row: there is no list
  of refused addresses to keep, so someone who says "this wasn't me" can be signed up again by a stranger, up to the
  same limits (accepted; the gateway's per-IP limit, M3, is the outer fence). The API counts each visitor's signups
  too (5 per 10 minutes per replica, IPv6 by /64, an IPv4 address written as IPv6 as itself, the oldest windows
  dropped first when full). Unconfirmed signups
  are deleted by each of the three functions and by an hourly `confirm_signup(NULL, NULL)` from the API process: one
  statement, not a job (ADR-0003 guardrail 1), and no new function or grant. The email's links carry the token in
  the query, which RFC 8058's one-click needs anyway; a GET never confirms or deletes: the page has a button that posts
  the token back, and the answer redirects without it, sends no referrer and isn't indexed; the language switch keeps
  the token. The form takes posts from the site's own pages only (`Sec-Fetch-Site`, else `Origin`); the one-click post
  comes from anywhere, as RFC 8058 requires. The form shows only with mail configured, a published privacy policy
  (which the database checks too) and an address for the links (the site's own hostname, or the platform's path).
  Country admins and platform admins see three counts on the site's dashboard; the address, the mailbox and the token
  are out of their column grants and of the audit log. A site taken offline keeps its list, and its links stop
  working, until it is back or purged. **Not built: the launch email and the deletion after it.** Sending it needs
  some role to read the addresses, which R119 doesn't settle: a question in the brief. Until then the form can open;
  nobody can be sent the announcement.
- **R123. One platform sender (R115), built:** nodemailer 10.0.16 (the newest past the 3-day rule) with `SMTP_URL`, a
  gitops secret, and `MAIL_FROM`, both or neither (the chart and the API refuse one alone), with timeouts of seconds
  (10 to connect and to greet, 20 idle) instead of nodemailer's minutes. A site's mail shows the operator's name with
  the platform's address, replies to the operator's contact address, and is plain text in the form's language. The
  confirmation goes out after the signup's transaction commits; if the mail server refuses it, the signup is deleted
  again with its own token, so the person can try again at once. A shutting-down API waits up to 10 seconds for
  emails on their way. Failures are logged and reported with the SMTP code and command only, never the message or
  the recipients, which quote the address; a signup that couldn't be undone is reported apart. `packages/i18n` now takes
  its translator from `use-intl/core`, the same `createTranslator` next-intl re-exported, so the API uses it without
  pulling in Next.
- **R124. The legal notice, the privacy policy and the page about the operator are served from now on, coming soon
  or not** (R44's missing links), each in the shared footer with the operator line and the contact address. The legal
  notice is generated from the operator's row, every field the operator gave (Q6 still open); the policy texts are
  the latest published version, with its number and date, in the page's language or else the default one, marked as
  such. Markdown is rendered with markdown-it 15.0.2: raw HTML escaped, images off, links only to http(s) and mailto,
  headings starting at h2. A text not published is a 404 and unlinked.
- **R125. The public site's election pages (M3), as built** ([spec](spec/public-site.md) §5): the scorecard, with a
  table on screens of 1,024 px and more (parties down the side, criteria across, the party column fixed and the table
  scrolling sideways inside a focusable region) and cards on smaller ones, one per party or, through a plain link
  (`?vista=criterios`), one per criterion; the party, criterion, cell and methodology pages. A cell is rated, pending
  (no revision) or withdrawn (its latest revision withdrew the rating, worded "Valoración retirada", provisional),
  never shown by colour alone: the rating visuals are fixed in `packages/ui` (a tick, a half, a cross, a slashed
  circle, three dots in a dashed circle, each outlined in ink, its mark at 3:1 against its fill, each place on a scale
  with its own shape and the same shape in both kinds of methodology, tests for all of it). Every scorecard, party,
  criterion and cell page has the legend with the methodology link (BRIEF invariant 2); every page has the operator
  line, and an e2e crawl checks both and that no page logs a CSP violation. A rating shows its date wherever it shows.
  A party's colour is an SVG fill beside its name, never a style attribute; its short name in the table carries the
  full one for screen readers. Content in another language than the page's says so (`lang`), and quotes and source
  titles carry their document's language, else the site's (WCAG 3.1.2). The wording of the scorecard's question and the
  methodology's lead follows the methodology's kind, like the legend, with a wording of its own if the demands' owner
  isn't public. Retired parties and criteria, and their cells, aren't shown or counted. An open site's home, and the
  preview host's, answers 307 to the current election (the soonest live, else the latest archived); otherwise it is the
  coming-soon page. The data is a new public route, `GET /public/tenants/{slug}/elections/{election}`, read as
  `aiontheballot_web` in one read-only snapshot (live and archived elections only; sources with their public columns
  only), cached by the web app for 60 seconds per election, at most 200 kept. Only an election the home lists reaches
  the API, so made-up slugs are a 404 that costs nothing; only the API's own "no public election" is a missing one, any
  other answer a failure (the last good copy stays). Page views are counted on the election pages too (R83). Every
  page's link preview is the home's card until per-view cards come (M3); once a site is open with a public election,
  the card names that election instead of saying "Próximamente" (an image asked for in the other mode is rendered, not
  redirected, so pods that disagree mid-rollout can't bounce a crawler). Not fixed: a signup form sent from a page
  loaded just before its site opens lands on the scorecard without its outcome (the email still goes out). Quotes and
  sources with no recorded language are marked in the site's language, the likelier one.
- **R126. Security headers on every response** (spec §7), from `next.config.js`: a CSP that loads nothing from another
  host, frames nothing and posts only to the site; HSTS without `includeSubDomains`; `nosniff`; a referrer policy;
  `Permissions-Policy`; COOP; `X-Frame-Options`. ADR-0003 keeps nonces off the public site, so the CSP allows inline
  scripts, which Next needs for each page's data: a question for Dani in the brief, since pages now render per
  request anyway. `pnpm dev` alone adds `'unsafe-eval'`, which React's development build needs. An e2e test checks
  the headers on a page, an icon and a route.
- **R127. Sitemaps, robots and the page's language** (spec §8): `/sitemap.xml` at a site's root lists what it serves
  in its mode (not the home once it redirects to an election), every language with its `hreflang` alternates, on the
  canonical base; a site's `/robots.txt` allows everything and names it. Crawlers read robots.txt only at a host's
  root, so the proxy answers it there for the hosts that serve sites by path: the preview host disallows everything
  (and sends `X-Robots-Tag: noindex` and the robots meta tag), even without routing data; the platform host allows
  everything and names the sitemap of each site whose canonical base it is. `<html lang>` now follows the page (R48's
  follow-up), from a header the proxy sets.
- **R128. The programme status on the admin's party page** (editorial workflow PS1, the scorecard's "Programa aún no
  publicado (comprobado el …)"): two buttons, "Checked: still not published" and "Checked: published", each a check
  that sets the status, even to the same one, and that the database stamps with its date (R29), in a live election
  too, as the spec allows; an archived election's, and a retired party's, is read-only on the screen. "Published"
  needs a source marked as the party's programme (R30): without one its button says so and sends nothing, and the
  database would refuse it anyway. A new route, `PUT /api/t/{tenant}/e/{election}/parties/{id}/programme`, runs it in
  the actor's transaction; RLS and the programme trigger decide (editors, country admins and platform admins, outside
  a freeze window). The database still lets a retired party's status change, which no public page shows. The party
  list in the admin and the public pages read the status and its date; the public sees a new check within the web
  app's minute.

- **R129. Sites, on the platform's own screens** (R111, revisits W6; editorial workflow P4): `/platform/sites` lists
  every site, on or off, with its addresses; `/platform/sites/new` creates one (short name, name in its languages,
  country code, main and other languages from those the platform has messages for, methodology kind, operator, report
  retention), always off, its operator linked in the same transaction; a site's page shows its details and addresses
  and turns it on or off, each behind a confirmation that says what follows within a minute. Everything goes through
  the policies and triggers that already exist: platform admins alone insert tenants and their operator links; the
  database refuses a site on without an operator, a malformed short name or country code, a taken short name; the
  API refuses `new` (the form's own address) and a retention past the column's bounds. No new grant, function or
  policy. Addresses are not written here: an adversarial review showed that adding one marked verified, and making it
  the main one at once, would redirect a live site to a host with no route yet, unrecoverably, and would replace
  ADR-0002's TXT verification with a platform admin's word, a change to the security model. They stay a runbook (an
  open question for Dani). Only the missing route keeps the admin from it: `aiontheballot_admin` still holds the
  grants and policy to write a verified, main hostname for a platform admin, which revoking would change ADR-0002 (the
  same open question). Not here either: changing a site's name, languages or operator, which stay runbooks.
- **R130. Demo content as SQL that Dani runs, never a seed** (task 5): `node packages/db/demo/print.ts sql <slug>`
  prints one `DO` block that fills an empty, active site whose country code is user-assigned (XA–XZ, but not XK, which
  Kosovo uses) with an obviously fictional election: three "Partido Ejemplo" parties, four "Criterio de ejemplo"
  criteria, two invented programmes as Spanish plain-text sources, four published cells (one of each rating, on the
  site's scale, summaries in Spanish and English) and the rest pending. It goes in through the real triggers
  (four-eyes, verbatim match, evidence), acting as three fictional members it removes at the end; first each
  programme's bytes go on the volume, in the site's `sources` bucket, the same day:
  `print.ts file a | kubectl exec -i deploy/aiontheballot-api -- node dist/put-file.js <site-id> sources`, then `b`.
  It refuses a real country's site, an inactive one, one with elections or none at all, one in a language other than
  Spanish or English, and takes only a slug, so it can't put fictional content into iaenlasurnas.es's tenant. Its test
  runs it as the owner role.
- **R131. The cell editor and the review workflow, as built** (editorial workflow C1–C3, C5–C14; task 6): the
  election's grid (`…/cells`), each cell with its state, published rating and flags in words (the rating icons of
  §2.5 not yet); a cell's page with its draft (rating on the methodology's scale, summary per language, and after the
  first publish a kind of change and a public note), its quotes with where each matches and in their document's
  language, the documents checked for "not mentioned", the workflow open to the user (start, submit, recall, approve
  and publish behind a confirmation, send back with a note, delete while never published and without a trail), its
  recheck flag, its comments and trail, and every published revision. Every change names the content version the
  editor loaded, and each transition the state it starts from (transitions don't change the version); the API locks
  the cell, compares, and answers 409 `cellChanged` if someone changed it first, and the screen offers a full reload
  (C14), apart from the database's own refusals, which keep their words. The draft form sends the version its fields
  were loaded at: when the page reloads after any step with a newer one, untouched fields show it, and edited ones say
  at once that the cell changed rather than save over it. The live match (W13) answers as the editor pauses typing
  (400 ms), through `POST …/sources/{id}/match`: up to 120 times a minute per member, the source checked under RLS
  every time, its normalised text kept (50 sources at most) once extraction is over, the matching itself outside the
  transaction. The trail names the site's members only (ADR-0002 §2, R94); anyone else, a platform admin included,
  is named as not a member. Publish is offered only to reviewers, country admins and platform admins, only in a live
  election (or an archived one, for a correction or withdrawal), and replaced by the reason when four-eyes forbids the
  user's own work (but not when they uploaded a file a quote cites, which the database refuses all the same). A step
  that removes its own button says it's done in the page's status line. A cell RLS won't let the actor delete (a
  published one) is a 403, never a silent success. Not built: the checklist of C5.2, C7.4's side-by-side view and
  quotes highlighted in their source (with the source viewer, S6), C4 (attested quotes, which need uploads, with
  sources, task 8), C10.4 (linking a right-of-reply report, which has no screen yet), and the dashboard queues of
  C1.2. The e2e test leaves the seeded cell's content as it found it, though its version moves on and its trail
  names the test's account. Changed after an adversarial review: the state checks, the `cellChanged` key, the
  draft form's version, names, the match's limits, announcements, and when Publish and Delete are offered.

- **R132. Sources, as built** (editorial workflow S1, S2.2, S3, S5, S6; task 8): each election's sources
  (`…/sources`), programmes first, with their party, kind, state in words and whether cells can cite them; a form to
  add one and change it until its copy is stored; the upload of its copy (PDF, HTML, plain text, PNG, JPEG or WebP, up
  to 50 MB, the same bytes kept once per site), which first says what storing it means under four-eyes (S2.3), and
  which the API checks before reading a byte (R139); its extraction, asked again with a button while it waits; its
  extracted text by page or section, members only; and its copy as a download (an attachment under a sandboxing CSP,
  never shown on the admin's origin, streamed from the store). A source's language is any two-letter code, with a
  region if needed (`app.locale`), not only the app's own two: a regional party writes in its own. Deleting is offered
  only before a copy is stored: from then on the data model keeps its text and its job for good (`source_texts` are
  never deleted, and a job's row holds its source), so a wrong source stays, unused (D14 asks about hiding it). In
  place of S6.1's PDF.js viewer with highlighted quotes, the page shows the extracted text, the same text quotes are
  matched against; the viewer comes later. Not built: fetching a copy by URL (S2.1) and archive snapshots (S4), which
  need the internet (D13), and attested quotes (C4).
- **R133. The worker's box, as built** (R116): a second Deployment from the API's image (`node dist/worker.js`), not
  root, a read-only root filesystem, no service-account token, its own memory and CPU limits, and only its database
  login (`aiontheballot_worker`) in its environment. Its NetworkPolicy lets only the API's pods reach it and lets it
  reach only the database and DNS. It runs one job at a time: the others wait with their bodies unread, at most 10 (then
  503), and a job it already has is refused (409); a job whose request went away (the API gave up after 31 minutes, or
  restarted) leaves the queue at once and is skipped when its turn comes. Each copy is parsed in a child process of its
  own, under Node's permission model (it may read only the app's folder and the packages' `node_modules`, never the
  workspace's root with its `.env`, and can't write a file, open a connection, start a process or build code from
  strings), with an empty environment, its V8 heap capped, a watchdog thread that kills it once its resident memory
  passes 512 MB (ArrayBuffers included, which the heap cap doesn't see), and a two-minute deadline. So a decompression
  bomb or an endless loop fails that job only, recorded as `failed`: a test inflates a PDF stream of under 1 MB toward 1
  GB and the child is stopped for its memory in about a second, the worker's own memory untouched. The watchdog checks
  every 10 ms, so a fast allocation can pass the limit by what it adds in that time; the pod's limit (1,280 MiB, which
  leaves room for the worker, the copy and the child's answer as it is parsed) is the last word, and past it the kernel
  stops the whole container, leaving the job open. A fault of the worker's own (the child can't start, the database is
  away) leaves the job open, answered 503, never `failed`; at startup the worker extracts a plain text, a web page and a
  PDF in its box, and stops if any parser doesn't run. It uses the bytes it is handed only if their SHA-256 is the one
  the source recorded (else 422, which the API reports), so whoever reaches it can't make it store other text; it writes
  in the requester's name (W11), and the database's job scope does the rest. PDFs page by page with PDF.js (`p. N`,
  empty pages skipped), web pages at their headings with Readability on jsdom, plain text by blank-line blocks (`§ N`);
  control characters become spaces and NUL goes; images, and PDFs without text, are `not_applicable`. Accepted: a parser
  exploit running code in the child could still signal the worker's process (stop it), which the permission model
  doesn't cover; the worker's own liveness probe would restart it. How jobs reach it was D12 (decided: R146, ADR-0006).
  The chart renders it only when gitops names its login's secret, and without it the API stores copies and leaves
  their extraction waiting.
- **R134. No `elecciones.pauseai.es` alias** (Dani's decision; revisits the BRIEF's pilot hostnames):
  `iaenlasurnas.es` is the site's only address. The alias was a fallback while the product's name was undecided; now
  it would only add a second name to promote, and it would be permanent (a hostname used publicly keeps redirecting
  for good), so the chapter could never use that name for anything else. One can still be added later if the chapter
  wants it: a verified, non-canonical `tenant_hostnames` row, and a hostname on the web route with its certificate
  (gitops).
- **R135. A site's public settings are data, not deployment** (Dani's decision, after reviewing what the app needed
  from gitops): whether a site is open (replacing R121's `OPEN_SITES`), whether search engines may index it (so a
  demo's fictional content never reaches one), and its Plausible script (replacing R83's `PLAUSIBLE_SITES`) are three
  columns of `tenants` (`site_open`, `search_indexing`, `plausible_script`), which a platform admin sets on the site's
  admin page, each behind its own route and, for opening and indexing, a confirmation. The database keeps them a
  platform admin's (`members_may_change` lists none of them for country admins) and checks the script's form; the
  public site reads them with the routing data as `aiontheballot_web` (new column grants, ADR-0002 §6 amended), so a
  change shows within a minute. A site kept out of search engines answers `noindex, nofollow` on every page and file it
  serves and in its robots meta tag; its `robots.txt` allows crawling but names no sitemap, so crawlers read the
  `noindex` (a disallow would leave indexed pages indexed); it has no sitemap and isn't named in the platform host's
  `robots.txt`. An older API's routing data, without the settings, reads as their defaults, so a rollout never hides a
  site; Plausible counts a site on its canonical host only, as `PLAUSIBLE_SITES` did in practice. What stays in
  gitops is what belongs there: secrets, the cluster's facts (registry, gateway, storage, `PLAUSIBLE_URL`), and each
  address's route and certificate. The demo runbook (R130) now ends in the admin: keep it out of search engines, then
  open it. Review of the remaining coupling, with Dani: `PLATFORM_NAME` could become data later; the per-hostname
  route line stays, since a catch-all route would take every unknown host the gateway serves. After deploy, Dani's
  steps: copy iaenlasurnas.es's `pa-….js` from the gitops `PLAUSIBLE_SITES` before syncing, enter it on the site's
  admin page as soon as the new admin is up (counting stops in between), then remove `PLAUSIBLE_SITES` (and any
  `OPEN_SITES`) from gitops; keep `PLAUSIBLE_URL`. Changed after an adversarial review: the rollout defaults, the
  robots.txt of a hidden site, the Plausible hint naming the main address, and the tests of opening.
- **R136. CI keeps one run's Turborepo cache, not every run's** (with Dani, who saw minutes lost to it): the checks
  restored the latest cache and saved it whole, plus their own outputs, under the next commit's key, so it only grew (a
  gigabyte in a day: 3 minutes to restore, 4 to save, on every run). Now each turbo command records what it ran
  (`TURBO_RUN_SUMMARY`), `scripts/prune-turbo-cache.mjs` deletes every entry no summary names before the save, and the
  checks save only when they added something; the E2E job restores the cache the checks saved or used (a newer run's
  could lack this commit's builds) and never saves. A task whose entry was pruned is just rebuilt; the prune never fails
  a run, and without readable summaries, or with entries it doesn't recognise, it warns and saves nothing. The old
  gigabyte caches were deleted by hand once, since a change like this one alters no task input and would keep
  restoring them. Changed after an adversarial review: the E2E job's key, and the prune's failure modes.

**Tooling, logos and the extraction worker (Dani's task list after R136):**

- **R137. The checks a push needs are one command, and they have a time budget** (Dani's request). `pnpm verify` runs
  them in order, the cheap ones first: the migration and release-note checks against `origin/main` (or the base it is
  given), lint, formatting, the type check, the unit, database and end-to-end tests, and the build; it stops at the
  first failure with the end of its log. `pnpm test:mutation <list>` breaks each rule a list names, one at a time, and
  expects a test to fail (`scripts/mutations/*.json`: the file, the exact text, its replacement and the command to
  run; a list whose text is gone reports it as stale). It is manual, never in a hook or in CI, since each mutation
  reruns its tests. `scripts/watch-release.sh` follows a pushed commit through CI, the release, Argo CD (until it runs
  the release bot's commit, Synced and Healthy) and the addresses in `WATCH_URLS`, all read-only. **Budget:** the full
  local sequence under 5 minutes on a warm machine (it took 2 minutes 45 seconds, most of it the database tests), which
  the script warns about; CI under 15 minutes from push to green once a runner is free (10 minutes on R136's run).
- **R138. A party's colour is always in sight** (Dani's request): the picker shows from the start, with "No colour" as
  a box beside it, unticked for a new party; picking a colour unticks it, so a party saved without one keeps it ticked
  until someone picks one. A new party starts at the picker's neutral grey. Every localized field in the admin is
  `autocomplete="off"` (Chrome offered personal addresses on an organization's name): they hold content, never the
  user's own details.
- **R139. Task 8's adversarial review, fixed before its first commit** (R132, R133):
  - **Uploads are checked before they are read** (was: 50 MB buffered first). The session, the role (editors and
    country admins), the source and that it has no copy yet (`409 hasCopy`) come first, the body waiting on the
    connection; then the bytes stream to disk, hashed on the way, and stop at 50 MB (`413 tooLarge`), keeping nothing
    (the store's `putStream`). The source is locked while the copy is attached, and a unique index (migration
    `open_extraction_once`) keeps one open extraction job per source.
  - **Copies stream out of the store**, to downloads and to the worker, checked against their hash as they go; the
    last chunk waits for the check, so a damaged copy arrives short of its length, never whole and wrong (`open`).
  - **Asking for the text again** is for editors and country admins only, 10 times a minute per member; each API
    replica sends a job once while it is on its way, and the worker refuses one it already has.
  - **Only the document's faults are `failed`** (the parser gave up, ran out of time or memory, or answered with
    something that isn't an extraction); the worker's own leave the job open.
  - **Text:** a web page's encoding is its byte-order mark, then its own declaration, then UTF-8 if it reads as UTF-8,
    else windows-1252, since a saved page loses the header that named it (html-encoding-sniffer, jsdom's own, with
    that default); plain text the same, without a declaration to read. Every text node lands in exactly one block,
    the innermost block element around it, so a paragraph in a list item no longer repeats and loose text is no longer
    dropped; `<br>` is a space; NUL is stripped from labels as from text; past 5,000 units neighbours are joined, not
    dropped.
  - **jsdom, not linkedom:** ADR-0003's spike chose jsdom (linkedom's types conflict with `lib.dom`), and the code had
    drifted; aligned, so the ADR stands. jsdom parses as browsers do, which is what editors copy quotes from.
  - **A second adversarial review** found nothing high and confirmed the two fixes above, then: a refused upload's
    unread rest is now read and dropped up to 1 MB and its connection closed 5 seconds after the answer (Node otherwise
    read any unread body to its end, or waited for a stalled one for ever, which also held a shutdown), and the API
    takes a whole request within 15 minutes; the worker's queue lets go of a job whose request went away, so asking
    again works at once, and the API waits longer than the worker can take; an upload must be one of the copy types as
    Fastify matched them (lowercase, as stored) and carry bytes (`415`, `400`), so nothing is stored that the database
    then refuses; the same bytes uploaded again as another type are refused (`409 otherType`: one file has one type);
    the worker answers 422 for bytes that aren't the source's copy, which the API reports, apart from 409 (already
    there); the child's answer is capped at 50 MB and its control characters become spaces, so the worker parses it
    within its memory; the startup check runs every parser; and the child reads only the app and its packages. Bytes
    stored before a later refusal (a race for the same source, a database fault) wait for the sweep (R117, R140).
- **R140. CI installs from the runner's persistent pnpm store** (Dani's request): the self-hosted runner already mounts
  one (`PNPM_STORE_DIR`, set in gitops), but pnpm doesn't read that variable, so every job downloaded all 686 packages
  again ("reused 0", up to a minute). The install step now names it as pnpm's store when it is set and writable, and
  keeps pnpm's default otherwise (GitHub-hosted runs). The runner does not keep its workspace between jobs, as was
  thought: each job starts afresh (checkout's "Deleting the contents" is what it says for any folder without `.git`), so
  the store is the only thing worth keeping; Playwright's browser (about 30 seconds a run) could be kept the same way
  with a second volume (gitops). The first run after this measures the gain. `watch-release.sh` reads Argo CD's revision
  from the first of the application's sources (it has several), and the mutation runner takes a list's name without
  `--only`, and marks mutants that can't fail as `equivalent`, with why.
- **R141. The scheduled sweep, as built** (R117, D7; ADR-0002 §2 and §6 and ADR-0004 §5 amended). Migration
  `file_sweep_list` adds `private.file_sweep_list()`: a `SECURITY DEFINER` function owned by the tables' owner, with an
  empty `search_path`, returning the sweep's list (every file row and brand asset, when rows stopped naming the others,
  the snapshot, the audit sequence, the database's identity, and whether every row was seen) and nothing else. Only
  `aiontheballot_sweeper` may execute it: a new login that owns nothing and has no other grant (a catalog test lists
  exactly `private` USAGE and that function). The grant is applied only if the role exists when the migration runs; the
  role comes from gitops, so in production its two `GRANT`s are the owner's to run once it is provisioned. `sweep-files`
  reads, with `--from-database`, the list with that login (`SWEEPER_DATABASE_URL`); the owner's manual sweep reads the
  same function (`--print-query`), so there is one list, and it no longer needs row security off. The API's chart
  renders a weekly CronJob (Sundays 04:43 UTC, `--delete --grace-days 120`, no retries, the volume mounted as the API
  mounts it, the API's pod security) once gitops names the login's secret (`fileSweep.databaseUrlSecret.name`);
  `scripts/seal-sweeper-role-secret.sh` seals its password and URL. A run that refuses fails its Job, is reported, and
  waits for a person. The previous session's drafts set `FILES_ROOT` to the volume's root; the API keeps the bytes in
  its `files` folder, which the CronJob names. Production needs, in order: the role in the database's values
  (gitops) and its secret (`scripts/seal-sweeper-role-secret.sh`), the owner's two grants, which the migration
  skipped before the role existed (`GRANT USAGE ON SCHEMA private` and `GRANT EXECUTE ON FUNCTION
private.file_sweep_list()`, both to `aiontheballot_sweeper`), then the secret's name in the app's values. _Done in
  production_ (Dani, 2026-10-12): the role, its sealed secret, the two grants and the values, in that order; the first
  run, started by hand from the CronJob, was clean: 6 files stored, 6 named, nothing orphaned. Changed
  after an adversarial review: the function names `pg_catalog.pg_database` and the other catalogs with their schema
  (unqualified, a temporary view of the caller's could have stood in for one and run as the owner; a catalog test now
  checks every definer for it); the scheduled run reports a refusal or failure to error tracking (a failed Job tells
  nobody), and on its deadline's SIGTERM finishes the file it is on and releases the sweep's lock; and tests now cover a
  successful scheduled run, the list read by hand, and a table owned by another role.
- **R142. Party logos, uploaded and shown** (Dani's task 1; editorial workflow E4; R104 left them out). A party's page
  in the admin shows its logo and, while the election is a draft, takes a new one or removes it; once the election is
  live it says a logo changes through a change request, which the database already enforces (`change_control`). A logo
  is a PNG, JPEG or WebP image, never SVG (which can carry script), at most 2 MB and 4,096 pixels a side, as brand
  images (R59), and must be the type its own header says (`imageSize`, moved from the share cards' package to
  `packages/domain` so the API reads it too). The upload is checked before its body is read (the role, the election's
  status, the party), then read whole, which 2 MB allows, and checked; its bytes go to the site's public assets, the
  same bytes being one file. A replaced or removed logo's file row is deleted when nothing else names it (another
  party's logo, a brand selection), so the sweep removes its bytes in time; a savepoint keeps a refused delete from
  undoing the change. Members see it through the API, as the image it is, sandboxed. The public site shows it beside the
  party's name, decorative (`alt=""`), on the scorecard, the cards and the party and criterion pages, served by the
  site's own `/brand/{sha256}.{ext}` route, which now also serves a logo of a party of one of its public elections
  (checked against the web app's copy of their data, so a made-up hash costs the API nothing); the API reads it as the
  public role, whose policy shows only a public party's logo. The seeds give Partido Ejemplo A a fictional mark, so the
  end-to-end tests see one party with a logo and one without. Not built: the logo on share cards (per-view cards don't
  exist yet), and the change request that sets a live party's logo (task 6, CR1). Changed after an adversarial review:
  the image check is strict (the whole PNG signature and a well-formed IHDR; a JPEG's segments walked strictly, fill and
  stray bytes refused, since a decoder skips them and could read a 65,535-pixel frame the check never saw, which the
  share cards' renderer, using the same check for operator logos, would also have tried to draw); a member may upload 30
  logos an hour (a replaced logo's bytes stay until the sweep's grace period ends, on a volume with no quota); a file a
  pending change request proposes is never deleted; two uploads of the same new bytes at once share one row; an upload
  cut short is a 400, not a fault; and the site serves a party's logo only where it shows its elections (open, or the
  preview host), checking the elections' data before refetching the home's. Not done, and worth doing: re-encoding
  uploaded images on the server, which would also drop their metadata (a camera's position, in the unlikely case a logo
  carries one) and could size them for the 24-pixel place they take.
  `packages/domain` builds on install (`prepare`), as `ui` and `og` do: `og` now imports it, and a fresh install
  (CI's) built `og` first and failed, which a workspace already built never showed.
- **R143. Change requests, on the admin's screens** (Dani's task 6; editorial workflow CR1; the database rules are
  migration `change_control`'s). Each election has a Change requests section: what may be proposed while it is live (a
  change to the election or its methodology, a new party, criterion or external reviewer), the requests waiting for a
  decision, then the decided ones; each says what it changes, from what to what, its public note, and who proposed and
  decided it (members' names only, R94). A live party's or criterion's page links to proposing a change to it, or
  retiring it. The form offers the target's change-controlled fields (one at a time, its value now shown, as the
  database will record it), each entered as its column takes it (localized text per language, a date, a colour,
  territory codes, the methodology's source kinds), and the public note. Editors and country admins propose and withdraw
  pending proposals; country admins and platform admins approve, which applies the change with their own rights;
  reviewers may reject (R24). Where the site needs no second approver, a country admin may propose and apply at once, in
  one transaction, so a refusal leaves nothing behind. The API (`…/changes`) takes only what the change rules allow for
  the target, with localized values in the site's languages and the public note required, and puts an addition last in
  its list; the database decides again, the previous value included, which it reads itself. Not built: changing a live
  party's logo, the methodology's demands owner or a criterion's core criterion this way (the database allows them; the
  screens wait for an upload to propose and for pickers), proposing from the methodology page per reviewer, and linking
  a right-of-reply report (CR1.8).
- **R144. Change requests, after two adversarial reviews** (R143). The first found nothing high and four mediums;
  the second checked the fixes and found two more (the lock's mode, and checks still left to approval). All fixed:
  - **Only country admins and platform admins approve, in the database too** (migration `change_request_approvers`;
    CR1.4). R24 relied on reviewers writing no structure, but one user may hold several roles (ADR-0002 §8): an editor
    who is also a reviewer could decide (as a reviewer) and write the change (as an editor), so approve alone, through
    "Propose and apply" or a decision. The change rules now refuse an approval by anyone else (`42501`), and the API
    refuses "Propose and apply" first; reviewers still reject. No new grant, policy or definer: the rule calls
    `private.my_tenants` and `private.is_platform_admin`, as the policies do.
  - **Two approvals of one target run one after the other:** the rules lock the target while approving, so the second
    reads the first's value and is refused as stale, instead of writing over it under a public "before" value that was
    no longer true (R25). The approver may write the target (R24), so may lock it. The lock is `FOR NO KEY UPDATE`, as
    the approved write's own: `FOR UPDATE` would also hold up every row added that points at the target (a foreign
    key's `KEY SHARE`) and deadlock two requests for one election proposed and applied at once. Tests race two
    connections, and add a request for an election while its own change is being approved.
  - **A proposal is checked as a draft's forms check it** (was: any value the column's type took): each column's
    bounds, a day as `YYYY-MM-DD` (never `infinity` or a year JavaScript can't show), territory codes as a flat list of
    ISO 3166-2 codes in the site's country, a colour as `#rrggbb`, a website as `http(s)://`, at least one source
    kind, a reviewer's name not blank, an addition with every column it can't be without (a criterion's short title
    too, which every live criterion has), and the public note and every public text in the site's main language. A
    refusal names the column's check, as the database's would, so the form points at the field. Left to the database
    at approval: a slug taken meanwhile, a demands owner the methodology's kind doesn't allow, and a logo file.
  - **An addition goes after those still waiting for a decision,** so two proposed one after the other keep their
    order; two at the very same moment may share a place, which every list breaks by slug (a reviewer by name).
  - Lows: each card's buttons name what they act on, and their result is announced by the page (they go with the
    card), while Cancel gives focus back to the button; the form takes each field's own length (a short title 40, a
    methodology 100,000), offers "No colour", marks each language in the current value and names source kinds; the
    territory codes hint is linked to its field; Spanish says "Baja" for a retirement and "Retirar la propuesta" for a
    withdrawal, and agrees with "solicitud"; a decider outside the site's members (a platform admin) is "someone who
    isn't a member of this site". Not done: hiding Approve inside a freeze window or on a stale target (the database
    refuses, `409`).
- **R145. The admin sends security headers** (found missing: it sent none, while the public site sends R126's). A
  Content Security Policy with a nonce of its own for every response (ADR-0003: nonces in the admin), set by
  `src/proxy.ts` on the request, where Next reads it for the page's scripts, and on the response: `'strict-dynamic'`
  lets those scripts load the app's chunks, and no other script runs; styles allow inline (server-rendered style
  attributes can't carry a nonce); nothing loads from another host; no frame holds a page and the admin frames
  nothing. Every admin page is already rendered per request, so none is served without its nonce. On every response
  (`next.config.js`): HSTS (no `includeSubDomains`, as R126), `nosniff`, `Referrer-Policy: same-origin` (not
  `no-referrer`, which would send the admin's own posts with `Origin: null`, refused by the API), a Permissions-Policy,
  COOP and `X-Frame-Options: DENY`. The e2e suite now fails any test whose pages log a CSP violation (`e2e/test.ts`),
  public or admin, in its own browser or any other it opens (`newContext`), and checks the admin's headers and that
  every script carries its page's nonce. After an adversarial review (nothing high): the proxy skips only build
  assets (it had also skipped not-found pages under `/_next/image…`), and the API's answers on the admin host are
  `nosniff`, `Cross-Origin-Resource-Policy: same-origin` and `default-src 'none'; frame-ancestors 'none'` unless a
  file route sets its own sandbox. Not done: reporting violations from production (`report-to` and a relay route),
  worth adding with the next relay work.

- **R146. Extraction jobs reach the worker over HTTP, hardened** (D12, answered by Dani: option B, on condition it
  follows best practice; [ADR-0006](adr/0006-extraction-jobs-over-http.md), superseding ADR-0003's pg-boss default and
  the data model's §8). The API still streams each job's copy to the worker once its upload commits, at most 4 at once
  per replica (the rest wait in the API), and now:
  - **retries by what failed:** a handover that reached nothing (no connection, 503, or 429, 502, 504 from anything
    between) is tried again at once, six tries in all, waiting 2 s doubled each time up to 30 s, half of each wait
    fixed and half random ("equal jitter"), about a minute, which covers the worker restarting; one whose connection
    went after the worker had the job (a restart, or a document that killed it) is not, and after 3 such losses waits
    for someone to ask; anything else (401, 422, 500, a missing or damaged copy, a job held past the worker's window)
    is reported at once and handed over again only when someone uploads or asks;
  - **hands an open job over again when a member lists its election's sources**, or opens the source's page: the
    listing reads the election's open extraction jobs in the member's own `withActor` transaction (members already
    read their tenant's `job_requests`), and after it each job open 5 minutes or more is handed over again, unless
    this replica has it on its way, tried it in the last 5 minutes, or gave up on it. No new function, grant or role;
  - **shares a secret with the worker** (`WORKER_TOKEN`, a bearer credential, compared in constant time after
    hashing both sides), beside the NetworkPolicy: the worker refuses a job without it (401) before looking at the job,
    and both refuse to start without it (32 printable ASCII characters or more); `GET /healthz` stays open for the
    kubelet. The chart requires `worker.tokenSecret` with the worker; `scripts/seal-worker-token-secret.sh` seals a
    random one. The worker is one pod, recreated rather than rolled (never two at once);
  - **reports jobs still open an hour after they were requested** (twice the longest a handed-over job can take),
    together, at most every half hour per replica, with how many, the oldest's wait and up to five ids. The worker now
    reports its own faults to GlitchTip by their class only (a SQLSTATE and routine, an error's name, never a message,
    which could quote the document), and a failed self-check at startup; it logs the self-check's success. Its
    NetworkPolicy may reach the error tracker's pods (`worker.networkPolicy.errorTracking`). A fault it didn't expect is
    now a 500 it answers itself, the job left open, instead of an error thrown to Fastify with its message.
    Changed after an adversarial review (nothing high): a lost connection is no longer retried at once (a bomb would
    have been parsed six times, then every five minutes), final failures are no longer redelivered, handovers are
    capped, stale jobs are reported together, the worker is a single pod, and the token's characters are checked.
    Mutation check: `worker-handover`, 28 of 28 killed. The worker is still off in production: the steps to turn it
    on are in the brief.

- **R147. Share images follow their pictures by themselves** (Dani's task 2, agreed; replaces R57's `TEMPLATE_VERSION`
  and its pinned SVG). Each template has fictional probe cards (`packages/og/src/probes.ts`) that exercise what it
  draws; the package's build renders them at every size and writes each template's fingerprint, a digest of those
  PNGs, over the compiled stub in `dist/fingerprints.js` (`scripts/fingerprint.mjs`, after `tsc`, in both `build` and
  `prepare`, so it runs in Docker builds, where `PACKAGED=true` skips `prepare`, and on fresh installs). `cardHash`
  folds the fingerprint in, so a template change or a satori, resvg, font or colour change that draws differently gives
  every image a new URL, and one that draws the same keeps them; it refuses a template without a fingerprint (as in
  source), so a build that skipped the step fails rather than serving changed pictures under old URLs. The web's home
  card now hashes under its template's name (`coming-soon`), so every home image gets a new URL once. A reference
  test compares each probe picture with a committed one (`packages/og/reference/`) through pixelmatch (pngjs 7.0.0,
  pixelmatch 8.0.0, dev only): anti-aliased edges and colour differences under its 0.1 threshold don't count, and at
  most one pixel in a thousand may differ, for rasterisers on other machines. On a failure it writes old, new and diff
  PNGs to `packages/og/test-output/`, which CI uploads (`share-image-changes`); `pnpm cards:accept` builds the package
  and rewrites the references. Renovate gives satori and `@resvg/resvg-js` a PR of their own (`Share-image renderer`),
  whatever the update's type. Mutation check: `share-cards`, 5 of 5 killed.

- **R148. Share images for every election page** (Dani's task 3; PLAN, social sharing; public-site spec §5.4). New
  templates in `packages/og` (`election-cards.ts`) for the scorecard (`overview`), a party, a criterion, a cell and the
  methodology, plus one for the corrections log that its page (task 5) will use, all in one poster frame: the site's
  name and the election on the accent, the content on a canvas panel, then the canonical address large, the
  methodology's short address and the operator small (BRIEF invariant 4; a test checks every probe at every size).
  They are drawn from a `CardTheme` passed in with the card's data (so part of its hash), never from the palette:
  today `DEFAULT_CARD_THEME`, the platform's roles; per-site branding passes its own later. The coming-soon card moved
  to it too. Ratings stay fixed: an icon drawn from `packages/ui`'s rating visuals plus their words, on the canvas.
  Choices: the scorecard's card shows the question, the counts, the parties' short names and the legend, never a
  tally per party (that would be a score the table doesn't give); lists show what fits, in two columns on the link
  preview, and "and # more on the site" past that; a cell's card shows the summary and the first quote's source. Each
  page's `og:image` and `twitter:image` is its own card, with alt text that says the ratings in words; images live
  under the election (`/{election}/og/{view}/…/{size}.{hash}.png`), render only at their current hash (else 307 after
  a fresh refetch, as R54), and 404 while the site is coming soon. A disclosure at the end of each election page offers
  the four sizes to download, on the page's own host, with no script. Pre-rendering: a page renders its own link
  preview while it is served; when the web app's copy of an election changes (its 60-second refresh, or a fresh
  refetch), it renders, one at a time, the link previews of the views whose cards changed, in every language (a first
  copy warms the overview, methodology, parties and criteria; cells warm when they change or are visited), for open
  sites only. Task 6's push from the API will make that immediate. The rendered-image cache is now bounded by bytes
  (64 MB) as well as count. Not done: the four sizes on the coming-soon home (its poster is up for the design refresh),
  and a party's logo on its cards when it is WebP (satori draws PNG and JPEG; the name stands alone).

- **R149. The right of reply, end to end** (Dani's task 4; BRIEF §4; editorial workflow H2, CR1.8). The database rules
  existed (migration `reports`); this builds the rest:
  - **The form lives under each election**, `/{election}/informar` (`/report`), optionally about one cell
    (`?partido=…&criterio=…`, linked from every election page, the cell preselected on a cell's page), and posts to
    `/{election}/informar/enviar`. Election-level words need no reserved slug (a tenant-level page would have needed a
    migration of the reserved list). It shows the right-of-reply policy when published and a consent line linking the
    privacy policy. A plain form: no script, no cookie; the outcome comes back in the query, in a status region; the
    page is `noindex`.
  - **Offered only while reports' retention is enforced:** the chart sets `REPORTS_ENABLED` only when it renders the
    daily anonymization (below); without it the API takes no reports and its home data says so, and the page says the
    form isn't open and gives the operator's contact address. It also needs a published privacy policy.
  - **Spam checks:** a field people never see must stay empty, and the form must have been open at least 3 seconds;
    failing either is answered as sent, sends nothing, and is counted in the log with nothing of the report. A form
    open over a day, or stamped more than a minute ahead, is answered "expired, send it again", never as sent. Posts
    only from the site's own pages (`Sec-Fetch-Site`, else `Origin`), URL-encoded, 64 KB at most. The API takes 3
    reports per visitor and 10 minutes and 10 a day, per replica, counting IPv6 by /48, and refuses a message with
    more than 5 links; the database caps a site at 200 a day (R14). Not built, and needed before the form opens on a
    busy site: the gateway's per-IP limit (M3), and signing the time field (it needs a secret the web replicas share).
  - **The intake** (`POST /public/tenants/{slug}/reports`) resolves the slugs as aiontheballot_web, so a report names
    only what the public sees: a published cell, else the election, with the cell's slugs at the top of the message
    for the editors. Fields are trimmed and checked (message 1 to 4,800 characters, name and organisation 200, the
    email normalised as signups' are; no control characters; no invisible formatting in a name, no bidirectional
    overrides in a message, which could make a link read as another), then `app.submit_report()`. A fault is reported
    by its SQLSTATE only, never the database's detail, which can quote the report.
  - **The admin's queue** (`/t/{tenant}/reports`, a new section): new reports first, filtered by status with counts,
    each with what it is about; a report's page with its sender, message (as written), triage (the moves the rules
    allow, or keeping the status to change the internal note; an anonymized report moves by status alone), who
    triaged it and when, what answers it, and, for country admins, removing its personal data behind a confirmation.
    Platform admins see none, and the page says why (P11).
  - **Linking (CR1.8):** a change request may name a report of its election past triage (`reportId`, a column and
    grant that already existed), which the API checks is the site's and readable by the proposer; the report lists it.
    Linking a correction (C10.4) needs a new column and grant on the cell's draft: D16.
  - **Retention:** a daily CronJob (`anonymize-expired-reports.js`, 03:29 UTC) runs
    `private.anonymize_expired_reports()` as aiontheballot_worker, the one role that may (data model §3.8, which had
    the worker do it; the worker is off). Rendered once gitops names the role's secret
    (`reports.anonymize.databaseUrlSecret`), which also opens the form.
    Changed after an adversarial review (nothing high): the expired answer, the daily and /48 limits, the retention
    gate, faults reported by class, hidden characters, triage after anonymizing, and tests of a member of two sites.
    Mutation check: `right-of-reply`, 13 of 13 killed.

- **R150. The corrections log, history and audit view** (Dani's task 5; BRIEF §4; editorial workflow H1, H3).
  - **The public corrections log** (`/{election}/correcciones`, `/corrections`), linked from every election page's
    footer and listed in the sitemap: every published revision of a cell after its first (an update, a correction or
    a withdrawal, with its rating now and its public note, linking to the cell), and every approved structural change
    (CR1.8: what was added, retired or changed, with the before and after of short fields such as names, websites,
    dates and colours, and only "changed" for long texts, ids and orders), newest first. The public election data now
    carries the approved structural changes (`changes`, read as aiontheballot_web from `structural_changes`, which
    was public already); a cell's first rating is no correction. Its share card says how many changes and the latest
    date (R148's corrections template).
  - **History in the admin (H1):** each published revision on the cell's page now shows its private record: who wrote
    it, who published it, whether it was self-reviewed (P14), and the report it answers when D16 is built. The
    election's corrections log as the public will see it is a new section of the election (H1.4). The diff view
    (H1.3) stays on the cut list.
  - **The audit view (H3):** `/t/{tenant}/audit` for the site's country admins and platform admins (others get no
    link and a 404; RLS would show them nothing anyway), and `/platform/audit` for the platform's own entries (no
    site), for platform admins: newest first, 50 at a time, filtered by who, table, row and days (UTC), each entry
    with what changed by column. Actors are named when they are the site's members (R94); others by a short id. The
    audit trigger already keeps personal data out of it.
    Changed after an adversarial review (nothing high): an external reviewer's name and affiliation are personal data
    (R26), so the public log never carries their values (the API sends none, and the page shows only that they changed)
    and doesn't name a retired reviewer at all, since `structural_changes` can never be changed or deleted; a revision
    shows the rating it gave, not "now"; a field without words of its own is "one of its details", never a column's
    name; the admin's log leaves out retired cells, as the public's does; the audit API answers 404 to anyone but
    country admins and platform admins, takes days as whole UTC days (to the next day's start, exclusive), ignores a
    day that isn't one, caps its cursor below 10^18, and the page shows times in UTC. Not done: an index for the audit
    log's filters (each filter scans the site's entries; fine at the pilot's size).
    Mutation check: `records`, 10 of 11 killed, 1 equivalent (named in the list).

- **R151. Instant refresh on publish** (Dani's task 6; ADR-0003, keeping the public cache fresh; editorial workflow
  PC1.2). After any admin write that goes through (not a read, not a refusal) to a site (`/t/{tenant}/…`, or a
  platform admin's `/sites/{site}/…`), the API tells every replica of the public site which site changed, and which
  election when the write named one: `POST /_internal/revalidate` with `{ tenant, election? }` to each address of a
  headless Service in the web chart (`<release>-web-pods`, resolved to every ready pod; the API's
  `WEB_REVALIDATE_URL`). Each replica refetches the routing table, the site's home data and the election (every
  election the site lists when none is named, since an operator's name or a logo shows on all), after any fetch
  already on its way; one refetch per site and election runs at a time, and one more follows if asked meanwhile.
  Refetching an election pre-renders the link previews of the views whose cards changed (R148). Fire and forget: a
  replica that misses it catches up within its minute, which stays the safety net; the API logs how many weren't told.
  Choices:
  - **The web's caches are one per process now** (`processWide`): Next bundles the proxy, the pages and the route
    handlers apart, so each had its own copy of the routing table, the home data and the elections, and a refresh in
    one left the others stale (the share-image cache already worked this way).
  - **No secret on the endpoint:** it carries no data, only what to refetch from the API, which decides what is
    public, and it answers only on an internal address (an IP, `localhost`, `*.cluster.local`), which the gateway never
    forwards (from the internet it is a 404, for every method, from the proxy). A site the refetched routing table
    doesn't list goes no further, and at most 32 sites or elections are refetched at once (503 past it), so the worst
    another pod in the cluster can do is make replicas refetch real sites, one at a time.
  - **One refresh at a time per site, election and routing table** (`refresh-queue.ts`): a forced load gets a refresh
    that starts after it was asked for, shared by every force before it starts, and a key's refreshes never overlap,
    so a burst of writes costs two fetches and an older answer never overwrites a newer one.
  - **The API names the site and the election, not views:** each replica finds the views whose cards changed by
    comparing the election's data before and after, which also catches what a write changes indirectly. A change to
    an organization tells every site it runs or endorses, which no path names. Telling never fails the write.
    An e2e test renames a live election of its own site in the admin and sees the public scorecard change within five
    seconds (its copies otherwise last a minute).
  - **Changed after an adversarial review:** unknown slugs no longer reach the caches (they grew without bound for a
    pod posting made-up ones), the bound on refetches at once, the refresh queue (forces ran side by side, and a fetch
    started before a write could land after the one started after it), the proxy's 404 for every method, a stricter
    internal-address check (`isIP`, a numeric port), HEAD no longer counted as a write, organizations' sites told, and
    the loaders' `force` tested. Found while checking it: the quote's live match, a POST that saves nothing, told the
    public site at every pause in typing; a route now says when it writes nothing. Not taken: refusing requests with
    `X-Forwarded-For`, which Next.js adds itself, so the API's own would be refused too; a web NetworkPolicy, left for
    when the cluster's policies are reviewed together. Mutation check: `revalidate`, 18 of 19 killed; the other is
    equivalent (every refused write throws, and its answer returns before the notice).
- **R152. Runbooks and the launch checklist** (Dani's task 7; M5). [docs/runbooks/](runbooks/README.md) has one
  runbook per situation (incidents, corrections, the reflection-day freeze, restoring the database, moving to other
  hosting, domain renewal), each saying who acts, what they run and what they should see;
  [launch-checklist.md](launch-checklist.md) is signed off at the launch go/no-go, copied into its issue. Choices:
  - **A release is rolled back by reverting the release bot's tag commit on `main` with `[skip ci]`** (and, after the
    preview, fast-forwarding `production` to it): CI on the revert would start a release, which rebuilds every
    deployable whose version differs from its tag and writes the bad tags back. A tag-only commit marks no
    deployable, so the pre-push checks pass. Migrations don't roll back; a bad one is fixed by the next. Learned on
    the way: GitHub skips CI for a push whose last commit's message holds the marker anywhere, as R152's own did by
    quoting it, so its release came with the next commit.
  - **A real restore stops the writes first** (the API at zero replicas through gitops), **restores into a second
    database, then swaps names** in one transaction (closed to connections, connections ended, both renames
    committed together, so the database's provisioning never sees the name missing and creates an empty one).
    The damaged database is kept, closed, to read from. `pg_restore` into an existing database leaves out
    database-level grants, so the runbook revokes `PUBLIC` again as the baseline migration did. An Argo sync then
    brings the schema up to the release.
  - **What a restore rewinds is listed from the damaged database first** (a count by site, table and action, plus
    ids). Access and personal data are put right by the operator in the restored database before it opens (members
    and platform admins removed, invitations revoked, signups unsubscribed, every session deleted), since a removed
    member mustn't get back in even for minutes; the audit log names no actor for those rows. Everything else is
    redone through the admin, freeze windows first, so the audit log stays true. The sweep's ledger is deleted after
    any restore (ADR-0004 §5).
  - **A compromised platform admin loses that role by the operator's SQL,** sessions first: no screen removes it, and
    a platform admin can give themselves any site's roles again.
  - **Moving hosts restores the dump before the chart's first sync** (a migrated empty database would clash with it),
    and moves DNS without deleting a record: DNS automation that would delete a record whose route goes (such as
    external-dns with `policy: sync`) is set to only add and update first, and the records are repointed by hand.
  - **The report form has no switch of its own:** in an emergency it closes with the anonymization job (R149), which
    catches up when it is back. A separate switch can come if abuse needs one; the per-visitor and per-site limits
    come first.
  - **A lost authenticator isn't reset by improvised SQL:** its owner-run reset (A5.4) is a launch-checklist item.
  - **The freeze runbook carries no dates:** the window comes from the chapter's legal advice (Q8) and the election's
    own date. Site-wide settings, releases and going live are kept still by agreement, since the database freezes
    only the election's published content.
  - **Changed after an adversarial review** (read-only, against the schema, charts and gitops): the rollback's branch
    after the preview, the platform admin's removal, the rewinds the restore listed (freeze windows, invitations,
    platform admins, passwords, settings, with a catch-all count), writes stopped before a restore, the swap made
    atomic and the database grants restored, migrations after a restore, the move's order and DNS, and smaller facts
    (multi-source revisions, the worker's name, who may clear a freeze, the checklist's mail, backup alerts and export
    items).
  - Not written yet: the export of one tenant (data model §3, on the checklist to write or waive) and the platform
    admin's MFA reset (ADR-0002), which waits for A5.4's command.
- **R153. The database pools survive a lost connection** (found by R152's review). Neither pool had an `error`
  listener, so when Postgres ended an idle connection (a restart, a restore's swap), pg's error went unhandled and the
  API process exited. `createPool` (packages/db) adds one that logs only the SQLSTATE; the pool has already let that
  connection go and opens another when asked. Test: emitting the error throws nothing and logs no message; mutation
  check `pools`, 1 of 1 killed.

- **R154. The admin has icons** (Dani noticed it had none). The platform's default site icon, the one the public site
  shows for a site without its own (the ballot and the box), drawn at build time by the share images' renderer
  (`@aiontheballot/og/site-icon-render`, now an admin dependency, its native module kept out of the bundle as in the
  public site): `/favicon.ico` (16, 32 and 48 px), `/icon-32.png` for tabs and `/apple-touch-icon.png` (180 px), named
  by the root layout and cached a day. The same icon as the public sites, not a distinct one: the tab's title already
  says which is the admin. A unit test checks sizes and types; an e2e test, that the production build names and serves
  them.

- **R155. Quotes picked from their source** (Dani's task 1; editorial workflow C2). Once a source is chosen in the cell
  editor, its extracted text shows beside the quote form, page by page: the text quotes are matched against, read from
  the source's own route in the API under RLS (members only, S6.2) when it is chosen, shown as text, in a region that
  scrolls and takes focus. Selecting a passage there and pressing "Use the selected text" fills the quote and the page
  field; the live match checks it, and the database matches it again on save. No new route, grant or rule. Choices:
  - **The quote is the passage as it is in the source,** line breaks included, its pages joined by one space as the
    database joins them, blanks at either end dropped, so a picked passage always matches where it was selected, a word
    hyphenated across a line break included. The editor may tidy it before adding it; the live match says whether it
    still matches. A unit test runs picked passages through the live match.
  - **The page is the label of the first unit the passage takes text from, or the first's and the last's**
    (`p. 1–p. 2`, the match's own form), cut to the field's 200 characters. It stays a hint (C2.8): when the same words
    appear earlier in the source, the database matches the first occurrence and the public sees that page.
  - **Only the units' text is taken:** each page's body is one text node, and the selection's ends are placed against
    each, so labels (unselectable on screen too), the gaps between pages and anything outside the panel never land in a
    quote. A selection over 1,000 characters is refused with a message rather than filled; none says to select first.
    Pressing the button doesn't move the selection it reads.
  - **Keyboard:** the region takes focus, so it scrolls with the keyboard; selecting text without a mouse needs the
    browser's caret browsing (F7 in Chrome, Edge and Firefox). Typing or pasting the quote works as before, so picking
    is a shortcut, never the only way.
  - Not built: saved quotes highlighted in the text (C7.4, with S6.1's viewer).
    The e2e test picks a paragraph by clicking it three times and a passage across two pages, checks both fields, the live
    match and the saved quote's match, and removes it again; the two tests that write quotes on the seeded draft now run
    one after the other.

- **R156. The owner's reset of a lost authenticator** (Dani's task 2; editorial workflow A5.4; ADR-0002 §9 and §10
  amended; R93, R152). `reset-authenticator.js`, run like `create-account.js` (`kubectl exec -it` in an API pod, never
  `kubectl run`), asks for the account's email address twice (never on the command line, and a slip changes nothing),
  shows the account's id, whether it has an authenticator and its open sessions, and asks to type `reset`. Then, in one
  transaction as `aiontheballot_auth` (no new role, grant or function to execute), it deletes the account's
  `two_factors` row (TOTP secret, backup codes, any lock from wrong codes), sets `two_factor_enabled` false, and deletes
  every session, any sign-in waiting for a code and any trusted device. The next sign-in with the password is an aal1
  session at the enrolment stage, as for a new account (R84). It prints no personal data (the account's id only, never
  the address or the name), and a fault by its code alone, saying to run it again to check. Choices:
  - **An aal2 session needs a second factor, in the database** (migration `aal2_needs_second_factor`, a trigger on
    `auth.sessions` running as Better Auth's role): a code checked a moment before the reset could otherwise insert its
    session after the reset's delete, an aal2 session for an account with no factor that becomes fully signed in once
    it enrols again. The insert locks the account's factor row (KEY SHARE) and the reset locks that row before the
    account's, the order a session insert takes them in, so one waits for the other and never both: a session written
    first is deleted with the rest, one written after is refused. Only the row's existence counts, since enrolment's
    own code opens its aal2 session before Better Auth marks the factor verified.
  - **A factor stored without the flag** (Better Auth would refuse to enrol another) counts as one, so such an account
    can be reset; an account with neither changes nothing, nor does an unknown address or an answer other than
    `reset`.
  - **The password, roles and a platform admin's row stay:** they give nothing until the new enrolment (ADR-0002 §9),
    and removing roles would make the site's country admins grant them again.
  - **No password reset with it:** in the moment between the reset and the person's sign-in, whoever knows the
    password enrols. The runbook (incidents §5a) has a country admin confirm who asks by a channel they already use,
    resets when the person is ready to sign in at once, and treats a code prompt they never set up as a compromise.
    A password someone else knows has no remedy yet but removing the account's roles (A5.2's reset isn't built): a
    question in the brief.
  - **No audit row:** `auth` has no audit trigger and `aiontheballot_auth` can't write `app.audit_log`; the runbook's
    note in the issue tracker (account id, who asked, who confirmed, when) is the record. The launch checklist now asks
    for one rehearsal in production, on an account made for it and deleted after, by guarded SQL in the runbook.
    Tests (API database tests): the lookup as Better Auth keeps addresses; a reset removes the factor, two sessions, a
    waiting sign-in and a trusted device, after which the old code and a backup code fail and the same password enrols a
    new secret and signs in; a stored factor without the flag is reset; nothing changes for an account without a factor
    or one that is gone; both races, on two connections; and the command itself, which asks twice and before changing
    anything, tells a fault by its code, and prints neither the address nor the name. Changed after an adversarial review
    (nothing high): the race above (medium), the address asked twice instead of confirming an id nobody can check, the
    stored factor, the fault's wording, the tests, and the rehearsal's SQL. Mutation check: `reset-authenticator`, 11 of
    13 killed, 2 equivalent (the account row's lock, and taking the factor's lock first, which only rules out a deadlock
    no test can hold still).

- **R157. A correction names the report it answers** (D16, approved by Dani; editorial workflow C10.4, W14; ADR-0002 §6
  amended; R22 left `revision_internal.report_id` empty). Migration `draft_report_link`:
  `assessments.draft_report_id`, a composite foreign key to the site's reports, with `UPDATE` granted to
  aiontheballot_admin (a new grant; nobody inserts it, so a new cell starts without one). It is draft content: changing
  it bumps the version, makes its writer a contributor (so four-eyes keeps them from publishing it), is locked in
  review and returns a published cell to draft; `restrict_columns` keeps it to editors and country admins. A trigger,
  running as the writer under RLS, refuses a change by someone who can't read the report named before or after it, as
  a permission error (a platform admin reads no reports, P11, so neither sets nor clears one), and a report about
  another election as a check. Publishing copies it into `revision_internal.report_id` (the allowlisted
  `publish_revision`, changed only there) and the next generation's draft starts without it, as without a change kind
  or a note (`assessment_transition`). The admin's draft form offers it after the first publish, from the election's
  reports past triage and the one linked now (listed even past the reports list's length), as the change request form
  does (CR1.8), and sends it only when changed; elsewhere the page says the draft answers a report. The API checks,
  after the version, that the report is one of the election's the writer reads (else 404). Choices:
  - **The foreign key is deferrable, deferred only by the tenant purge:** a report names its cell and now a draft names
    its report, and the purge deletes reports before cells. Checked at once otherwise.
  - **Any report of the election, about it or any of its cells, whatever its status:** a report about one cell may show
    another wrong too, and a rejected report keeps its link, which stays private. The form offers those triaged or
    accepted.
  - **Any revision may answer one, the first included:** the form offers it after the first publish, as a correction's,
    but a first rating that answers "you haven't rated this" is no misuse, so the database doesn't refuse it.
    Tests: database tests (content and contributor, the copy and the clear on publish, the lock in review, a reviewer and
    a platform admin refused, a platform admin unable to clear it, another election and another site refused, a purge
    with a linked draft), the isolation matrix (a `draft_report_id` column case: the site's editors and country admins
    only; locked in review), API data tests (the election's report only, the version checked first) and route tests (an
    unknown, another site's or a platform admin's report is a 404; a form without the field leaves it). No e2e test: the
    seeds' only published cell is read by other tests, and a draft of it can't be put back. Changed after an adversarial
    review (nothing high): the form no longer clears a link it couldn't list (it sent "none" for a report past the list's
    500), a platform admin can't clear one, the API's check runs after the version and within the election, the page says
    a link the form doesn't offer, and the route test puts the fixture back whatever fails. Mutation check:
    `draft-report`, 12 of 12 killed.
- **R158. The gateway's per-address rate limits, built off** (Dani's task 4; ADR-0001, Traffic spikes, amended; R14,
  R122, R149 left them to the gateway). Checked first, read-only: the public gateway sees the real client address,
  trusts no forwarded header and strips any a client sends (its `ClientTrafficPolicy`, gitops). Two findings changed
  the plan of a policy in gitops alone:
  - **One BackendTrafficPolicy per route:** the web chart already renders one for its HTTPRoute (retries, idle
    timeout), and Envoy Gateway refuses a second policy on the same route as conflicting. So the limits are a
    capability of that policy in the chart, as gitops' own rule has it (charts define capability, gitops environment):
    `route.trafficPolicy.rateLimit` in the web chart's values, four groups in requests a minute per address, 0 by
    default, which renders exactly what it did before (compared). The groups: `forms` (any POST but the relays: a
    report, the signup list, its confirm and unsubscribe), `errorRelay` (POST `/_relay/errors`), `analyticsRelay` (POST
    `/_relay/views`) and `images` (GET and HEAD of share images, `/og/` anywhere in the path, the costly ones to
    render; icons and logos under `/brand/` are served from a cache and stay unlimited). The paths stay in the chart,
    which knows them; the numbers go in gitops. Counted per address (IPv4 and IPv6 rules apart), host and rule.
  - **A bucket per address needs global limits:** "Local rate limiting does not support distinct matching" (Envoy
    Gateway's documentation). So the rules are global, which needs Envoy Gateway's rate-limit service and a Redis
    for it (gitops). **With any number set and that service off, Envoy Gateway answers every request of the web route
    with 500**, so the order matters: the backend alone (synced, `envoy-ratelimit` Ready, the controller's config
    reloaded), then the numbers, then a check that the policy is accepted and the site answers 200; undone in
    reverse, numbers to 0 first. The gitops values follow that order, with resource limits for the service. The
    numbers (gitops) are a flood ceiling above what a crowd behind one address sends (a venue's wifi, a carrier's
    NAT), so the app's own limits answer first, in the site's words, not Envoy's bare 429. Behind a CDN's proxy every
    visitor would be a few of the proxy's addresses, so the contingency now sets them to 0 first (ADR-0001, incidents
    §7). The rendered policy was checked against the CRD's schema, and the controller's config against Envoy
    Gateway's chart rendered with the gitops values. The chart's CI values set the numbers, so `helm lint` renders
    the rules.
    Changed after an adversarial review (one high: the 500s above, which the docs had called a refused policy): the
    rollout order, higher numbers, `/brand/` unlimited, the proxy step, numbers read as integers (a quoted "0"
    rendered a limit of 0), the deprecated `type` field dropped, and the rate-limit service's resources. Not done: an
    e2e test (the stand-in gateway isn't Envoy); a shared bucket per endpoint, which local limits could do without
    Redis but one abuser could empty for everyone; and Next's image optimizer (`/_next/image`), which the review noted
    could fetch a share image under another path: the site uses plain images, so turning it off costs nothing, a small
    change left for the next web release.

- **R159. The admin's rating icons, work queues and submit checklist** (Dani's task 5; editorial workflow C1.1, C1.2,
  C5.2, §2.5; R131 left them out).
  - **Ratings look as the public sees them:** the cell grid shows each cell's published rating as icon, words and
    colour (pending before a first publish, withdrawn after a withdrawal, in the public site's own words), then its
    working state and flags; the cell page shows it on its revisions, its read-only draft and the rating choices. The
    icon is the share cards' own drawing (`ratingIconSvg`, packages/og, from packages/ui's fixed visuals) as an image
    beside the words, so the admin, the public pages and the cards can't drift apart. A grid cell's link names its
    rating first, then its state.
  - **Work queues on the site's dashboard** (`GET /api/t/{tenant}/queues`, read in the member's own transaction, so RLS
    decides what each holds; the roles only decide which queues are theirs): their drafts, drafts sent back to them
    (the latest workflow event a rejection, comments aside, as the grid reads it), cells in review they had no hand in
    (reviewers, country admins, platform admins), recheck flags and sources whose text failed (editors, country admins,
    platform admins), change requests waiting for a decision, and the count of new reports (members only: a platform
    admin reads none, P11), linked to the reports filtered as new. The first 20 of each, oldest work first, with how many
    in all; a queue with nothing in it isn't shown, and "Nothing waits for you here" when none is.
  - **The editor's checklist** (C5.2): above Submit, while the cell is a draft, what submitting needs as
    `assessment_trail` and `submitted_evidence_rules` check it, each with a sign and words: after the first publish a
    change kind and a public note in the site's main language; a withdrawal no rating; otherwise a rating, a summary in
    the main language, and a quote, or for "not mentioned" a checked, stored document of the party's own of a listed
    kind; and every quote matched or attested from an admitted kind, every checked document of a listed kind. A pure
    function with unit tests; the cell's sources now say whether their kind is listed for "not mentioned" whoever's
    they are (`listedForChecks`), since a party-neutral document may be checked too. The database decides again.
    Tests: unit tests of the checklist, API database tests of the queues (an editor's, a reviewer's, a draft sent back
    and a comment after it, a recheck flag, a platform admin's, another site's), a route test, and e2e checks of the
    grid's icons and words, the dashboard's queues and the checklist of a new cell (with axe).

- **R160. The export of one site's data** (Dani's task 6; data model §3, BRIEF §7; R152 left it on the checklist). A
  runbook alone couldn't do it safely (a table missed, another site's rows or a credential let out), so the export is a
  script in the repository, `scripts/export-tenant.sql`, which the operator runs as the superuser in the Postgres pod,
  as the runbooks run SQL ([exporting a site](runbooks/exporting-a-site.md)): one read-only, repeatable-read snapshot,
  as JSON Lines (a header, one line per table with all of the site's rows, a footer counting them, so a file cut short
  shows). It holds every table of `app` with a `tenant_id` (a database test compares the list with the catalog, as
  `purge_tenant` checks itself), the site's row, the organizations it links, the brand assets it selects or was
  granted, the core criteria its criteria map to, and its members' names and emails (which its country admins already
  see, R94): never a password, factor, session or token's hash, not even in the audit log's diffs, which hold
  invitations' hashes. A test classifies every column of a site table that looks like a credential (left out, or no
  secret), so one added later fails until someone decides. The files' bytes come from the API's volume by `tar`, and
  a check compares them with the rows that name them. The runbook works in a temporary folder on the operator's
  encrypted disk (never the repository, whose `.gitignore` now refuses export files too, nor an external volume),
  checks the site against the written request before going on, encrypts with `age` for the person who asked and
  deletes the plaintext at once. Personal data goes out (reports, signups, invitations, members): the site's operator
  is its controller, and only someone who speaks for it may ask.
  Tests (database): every table and only the site's rows, counts equal; no other site's id, shared row or account;
  members' names and emails only; the credential columns; an unknown short name refused before anything is written.
  The psql layer itself (variables, `\pset`, read-only) was run against the local seeds: 42 lines, the footer right,
  an unknown or quoted short name refused with exit 3. Changed after an adversarial review (one high: the runbook's
  commands wrote the plaintext export into the repository's checkout, on an unencrypted external volume): the folder,
  the site's check, the plaintext's deletion, the shared rows' tests, the credential columns, the files' exact check.
  Mutation check: `export`, 10 of 10 killed. Not done: an import (a site that leaves takes its data; purging it is a
  separate decision).

- **R161. An opt-in ingress NetworkPolicy for the public site's pods** (Dani's task 7; R151 left "a web NetworkPolicy,
  for when the cluster's policies are reviewed together"). The web chart renders, when `networkPolicy.enabled` (off by
  default, so nothing changes until gitops says so), a policy on the web pods admitting connections to their port only
  from the Envoy pods of the gateways its values list (namespace and pod labels, set in gitops) and from the API's own
  pods (`app.kubernetes.io/name: api`, as the umbrella names them; not the worker's or the jobs', whose names differ),
  which tell every replica what changed through the headless Service (R151). Nothing else in the cluster: the site holds
  no secret, but its internal paths trust where a request comes from (`/_internal/revalidate` answers only an internal
  address), and no other pod has a reason to reach it. Ingress only: what the site reaches (the API, Plausible, error
  tracking) is unchanged. Checked read-only first: only the public gateway routes to the web Service, nothing else needs
  to reach it, and the kubelet's probes still pass (the worker's own policy already relies on that). Turning it on with
  no gateway listed, or a gateway without pod labels, fails the chart's render (a CI check renders both and expects the
  failure), rather than shutting every visitor out while the pods stay Ready, or admitting a whole namespace; CI also
  checks the policy's API selector against the API Deployment's labels. Turning it on is a gitops change; what to watch
  afterwards: both hostnames answering, and a publish reaching both replicas at once. Previewing through the admin (D15,
  ADR-0005 option A) would add a rule for the admin's pods, as ADR-0005 says. Changed after an adversarial review
  (nothing high in the draft; one latent high: an empty gateway list rendered a policy that only the API passes): the
  render refuses it, the preview-host guidance, the API name's coupling.

- **R162. The whole table as one image, to download** (asked by Dani during the run: "this is the kind of card I am
  referring to", a Greenpeace-style table; R148's scorecard card shows the parties and the legend but no ratings).
  A new share-card template, `table` (`packages/og`): the scorecard's question, then parties down the side and
  criteria across by their short titles, as on the site (the orientation Dani fixed, so pictures stay comparable), a
  rating's icon in each cell, rows striped so the eye follows one across, the legend that gives the icons their words,
  and "Actualizado el …", in the share cards' frame (site, election, canonical address, methodology, operator).
  Column titles lie flat while a column is wide enough for three lines of them, and stand on end (read from the
  bottom up) when it isn't; rows and headers share the panel's height so titles stay whole while rows keep a readable
  height. Offered only to download, from the scorecard's dialog, in the square, portrait and story sizes
  (`/{election}/og/table/{size}.{hash}.png`; the link preview's 1200 × 630 is refused, too low for a whole table):
  - **Not a link preview** (Dani's worry about Meta's and WhatsApp's caches): a preview is cached by the crawler, for
    weeks on Meta's side, so a table there would go stale under a shared link. The election page's preview stays the
    overview card, whose content (question, parties, counts) rarely changes; the table is rendered when someone
    downloads it, so it is current then, and posted it is a dated snapshot, like the image Dani showed. Its hash
    changes with any rating, so a download never gets an old picture from a cache. Asking Meta to re-scrape pages on
    publish (a Facebook app token) is a question in the brief.
  - Two fictional probes (3 × 4, and 8 × 15 with column titles on end) fingerprint the template and are its reference
    pictures (R147); the other templates' fingerprints didn't change. Tests: a unit test of the card and its paths, and
    the share e2e test downloads the three sizes from the seeded scorecard and refuses the link preview's.
    Not done: party logos in the table's rows (a card draws one logo today), and the same table on the coming-soon page.

- **R163. No image optimizer on either app** (R158 left it for the next web release; asked by Dani: "anything you can
  do autonomously"). Next's `/_next/image` was on in both apps, though neither uses `next/image`: every image is a
  plain `<img>` (logos the brand route serves, share images drawn at their own paths). Checked first, on the demo and
  in an e2e probe: on the public site it drew nothing, since its fetch inside the server carries no Host and so never
  reaches a site's routes (a share image's public, preview or internal `/_tenant/…` path, a logo: all "internal
  response is invalid"), so no share image of a site that isn't open could leave by it; in the admin it could resize
  only the admin's own public icons. But each call was a fetch inside the server and an error in its log, and an
  endpoint that would sit outside the gateway's limit on share images (R158: they match `/og/` in the path, and here
  it is in the query) the day it did reach one. Now `images: { unoptimized: true }` in both: Next answers
  `/_next/image` with the not-found page, with the security headers, before fetching the image. The public site's
  proxy no longer skips the path (it is no build asset): it passes it through as a system path, as any `/_next/`
  (ADR-0003's defaults table corrected: it had said the proxy skips all of `/_next/`). Tests: e2e, on a site's host
  and the preview host (a 404, the not-found page, not the optimizer's words, with the CSP) and in the admin's
  security headers test, on its own icon. An adversarial review found nothing high or medium; its six low findings
  are fixed (the admin test's path, the claims above, a weak assertion, the ADR's row, a comment's length).

- **R164. The table image: every header shown, and rows that use the room** (R162's follow-up, from the live demo's
  picture: three parties left half the panel empty). Three changes to the `table` template, its reference pictures
  accepted again:
  - **A header standing on its end near the table's left edge was lost:** Satori clips a turned box where it stood
    before turning, and the box reached left from its column, past the table's edge when the party names' column is
    narrower than the header is tall (the 3 × 4 probe's story size lost "Ejemplo 1"). A column too close to the left
    edge now turns its box the other way (reaching right from below the header, about its top left corner), and the
    header is at most half the table's width, so every column has room on one side.
  - **Rows grow into the room left,** up to four lines' height (three before), and their icons with them (up to 2.6
    lines, 1.9 before); the names keep their size, which the party column is measured for.
  - **The legend's width is measured closer** (capitals of the display face, 0.46 em a letter, and no gap after the
    last entry): it had reserved a second line that never came, which the rows needed (the 8 × 15 probe's square
    size). It still errs wide, so a legend never runs into the date.

- **R165. Three gaps from a review of the database's row security, closed** (asked by Dani: "anything you can do
  autonomously"; M5's "RLS review", done as a first pass by an independent read-only reviewer against ADR-0002, the
  schema and the local database's catalog; a human or external review is still on M5). Nothing high: no runtime role
  reads or writes another site's rows or gains a privilege (every `app` table has RLS, every policy names a role, the
  web role writes nothing, the 13 SECURITY DEFINER functions are the allowlisted ones with an empty search path,
  views are security_invoker, every tenant-to-tenant foreign key is composite, `auth` is the auth role's alone).
  Each finding was checked against the schema before acting, and each fix written as a failing test first. Three
  migrations, one concern each, each tightening a rule to what ADR-0002 already said; no grant, no definer:
  - **A copy called fetched to dodge four-eyes** (`fetched_copies_from_jobs_only`): four-eyes counts a file's uploader
    as a contributor of every cell citing it, but only for an uploaded copy, and the admin role could write
    `file_origin = 'fetched'` unchecked. So one person could upload a document, call it fetched, have another editor
    quote it and publish the cell. Now only the worker (whose job scope already keeps it to fetch jobs) writes
    'fetched'; anyone else's copy, on insert or update, is refused (42501).
  - **Contributors added by hand** (`contributors_from_the_trail_only`): the policy let any member add themselves as a
    contributor of any cell, and a contributor may recall a cell from review with no note: an editor could send
    someone else's cell back, a reviewer reject one without the note a rejection needs. Only the cell's trail
    (`assessment_trail`, inside its trigger) adds a contributor now (`pg_trigger_depth() > 0` in the policy). Two
    tests that stood in for the trail with a direct insert now expect it refused and cover the trail's own insert
    with a real edit, and the generation rule, which a direct insert no longer reaches, is tested as the owner.
  - **The purge flag inside the owner's rights** (`immutability_purge_from_owner_sessions`): the immutable tables'
    exemption asked only whether the current user owned the table, which it does inside any SECURITY DEFINER function
    or foreign key action, whoever logged in; any role may set `app.purge`. Nothing used it (no definer function
    changes an immutable table, no cascade reaches one), but ADR-0002 §14 already promised otherwise. Now the login
    must be the owner too, as the other triggers' `private.purging()` asks (inlined: the runtime roles may not
    execute that function, and a grant to let them was not worth it).
  - **A meta-test made exact:** every function's search path must be empty, not merely set (a function pinned to
    `public` passed before).
    Tests: database tests (the matrix's self-insert case, the source's origin, the definer path under a runtime login),
    all passing. Mutation check: `rls-review`, every rule broken in turn fails a test (the policy's site clause is
    equivalent: the contributor rule refuses a cell the writer can't see, as another site's is). Changed after an
    adversarial review (nothing high; it found no way past any of the three): the data model's contributors comment,
    which still said adding oneself could only stop one approving; a test of the policy's user and site clauses
    through a probe trigger, which the depth check now hides from a direct insert; and a fetch requester's own
    four-eyes gap, recorded in D17 for when fetching is built. ADR-0002 (four-eyes, the refusals, the purge
    exemption; the worker's role in §2, which had said the admin role) and the data model updated. The rest of the
    review's findings are D17.

- **R166. Every open decision taken** (Dani, after this run's brief). Recorded in Answered: D13 and D14 are built
  next (D13 after the launch-critical work); D15 goes through the admin (ADR-0005 accepted); D17's attester rule,
  uuid foreign-key meta-test and the web role's grant hygiene are built next; password recovery is built (a
  security-model change, ADR-0002 to be amended with it); production keeps following `main`, with no `production`
  branch (ADR-0001 amended: with no staging, a branch to promote only delays what nobody sees first, and keeps agents
  from checking their own deploys; during the code freeze, changes come as pull requests the owner merges); Meta's
  re-scrape is possible later work. Done here, in the documents only: ADR-0002 §9 says what the database's MFA check
  rests on (the API's word, accepted as T23) and §14 that a report's audit entries keep its kind, cell, status and
  triage, which platform admins read too (D17b: kept, the text corrected); the incidents runbook's rollback no
  longer fast-forwards a branch; the corrections runbook says how to refresh a stale Facebook preview by hand. Also
  checked: the extraction worker is on in production (gitops sets its secrets; the API has `WORKER_URL`; the worker,
  which stops when a parser fails its startup self-check, has run for hours), so R146's "still off" no longer holds.

- **R167. An attester who wrote the cell's draft is refused** (D17a, Dani's task 1; migration
  `attesters_not_contributors`). Only the quote's author was refused, so another editor could rewrite a quote's words
  and attest them, in one statement or two. Now, while the election requires a second reviewer, the attester must not
  be one of the cell's contributors as four-eyes counts them (`private.revision_contributors`: whoever edited its draft
  since the last publish, a rewrite of the quote included, or uploaded a copy or attestation file it cites), nor
  rewrite the quote in the attesting statement (the trail records that contributor only after the row is written).
  Choices: **the four-eyes set, uploaders included**, not only the trail's (the review's medium finding: whoever made
  the screenshot shouldn't vouch for it), inlined because the admin role can't execute that function and a grant
  wasn't worth it; **checked on every update, like the author's rule**: attesting is refused (42501) and an attestation
  that stops holding lapses to unmatched (its attester edited the draft afterwards, or four-eyes was turned back on
  after a contributor attested), so publishing's re-check (a no-op update of every quote) never counts one, whatever
  the order or statement shape (a multi-row update or a CTE that edits and attests at once is caught there); the cost is
  that an attester who later edits the cell needs someone else to attest again; **the current generation only**, as
  the task says. Known limit, recorded rather than built: whoever rewrote a quote in an earlier generation (when someone
  else attested it, which that revision records) may withdraw that attestation and attest the same words in a later
  one; tracking each quote's last writer would close it. Tests first: the same-statement rewrite, an earlier rewrite or
  edit, each kind of upload, the later-edit and four-eyes lapses, the multi-row statement, a real publish for the
  earlier generation, and four-eyes off. Mutation check `attesters`: 11 of 11 killed. Changed after an adversarial
  review (nothing high; two medium, both above). ADR-0002 (verbatim match's exception), the data model and C4 updated.

- **R168. A meta-test for uuid references a foreign key doesn't pin to the tenant** (D17e, Dani's task 2). Every uuid
  or uuid[] column of a tenant table but `id` and `tenant_id` (domains over them included) must be in an enforced,
  validated foreign key that pins `tenant_id` to a tenant-owned parent's, or in one to a listed shared table
  (`SHARED_TABLES`: core criteria, organizations, brand assets), or be listed in the catalog test's
  `UNPINNED_ID_COLUMNS` with what keeps it in the tenant: 23 account ids (`auth.users`, which no app table
  references), `change_requests.target_id` (`private.change_request_rules`, as the writer, finds it in the request's
  election) and `structural_changes.target_id` (inserted only from a trigger, by its RLS policy). A listed column that
  becomes pinned, or goes, fails the test too, so the list stays exact. A probe table checks it reports a missing key, a
  key that skips `tenant_id`, one `NOT ENFORCED` or `NOT VALID`, a uuid array, a domain over a domain, a second tenant
  reference and a reference to a tenantless table that isn't listed as shared. No migration. Changed after an
  adversarial review (nothing high or medium): every uuid column rather than `*_id` ones, the shared tables listed
  rather than any table without a tenant, and enforced, validated keys only. CONTRIBUTING's checklist and ADR-0002's
  catalog list updated.

- **R169. The public role keeps only what the public API reads** (D17c, Dani's task 3; migration
  `web_role_least_privilege`). Checked first: the public API reads a policy text's kind, version, body and publish date,
  never `hostname_tombstones` (routing reads `tenant_hostnames`), and nothing in `private` (no policy for the web role
  or view it reads calls a helper there, and the four functions it may call are SECURITY DEFINER). So: a column grant on
  `tenant_documents` of what the public reads plus the row's id (which the matrix names rows by), without `created_by`
  or `created_at`; `hostname_tombstones`'s SELECT revoked and its public policy dropped (platform admins still read it,
  and the hostname trigger checks it as the writer); USAGE on `private` revoked. Tests first, each failing without the
  migration: the matrix (the public no longer reads a document's author or a tombstone), a catalog test that the web
  role has USAGE on `app` alone among all schemas, and the public-cache test, from whose exemptions the tombstones went.
  Mutation check `web-role`: 5 of 6 killed, 1 equivalent (the dropped policy reads nothing once the grant is gone).
  Consequence: answering tombstoned hostnames with 410 (R38's "small change") now needs a grant or a definer function,
  so an ADR-0002 update. Changed after an adversarial review (nothing high or medium): `created_at` out of the grant,
  the schema test over every schema, and the data model's public read model brought up to date. The review also found
  that the web role reads `organizations` whole, endorsers' legal fields included: D18. ADR-0002 §2's role table and §7
  updated.

- **R170. Password recovery** (R166, Dani's task 4). "I forgot my password" on the admin's sign-in page and "Send a
  password reset email" in Members, both through Better Auth's own reset and the platform's mailer, as
  `aiontheballot_auth` with the grants it has: no role, grant or function. The link is the set-password page's
  (`/set-password#token=…`, the token in the fragment), single use, an hour, stored as the token's SHA-256. Setting a
  password keeps the second factor (the next sign-in asks for a code), ends every session and every other link, and
  emails the account that its password changed; a lost authenticator stays the owner's command (incidents §5a, which
  now has members choose a new password first when the old one may be known). ADR-0002 amended (§9, §10, T28), and
  A5/A7 marked built. Choices:
  - **The same answer for every address**, and the email sent after it (in the background), so neither the words nor
    the timing tell; a malformed address is the one refusal the form words.
  - **One link per account every 15 minutes**, against flooding a member's inbox; a link that isn't sent (held back,
    or its email failed) is deleted by its token, so asking often can't hold the next one back. To delete by token,
    the identifier's hash is spelled out in the API (the same SHA-256, base64url, as Better Auth's own `hashed`, so
    links already out keep working). Better Auth's limiter also allows a visitor 3 requests a minute.
  - **Languages:** the forgot email and the changed notice in the page's language (the switch's cookie, else
    Accept-Language: the admin's negotiation moved to `packages/i18n`); the members email in the site's main language,
    as invitations are, naming the manager and the site.
  - **Who sends from Members:** whoever may lock the tenant's row under RLS (country admins, platform admins), the
    database's answer as for removing a role; only to a member of that site; 429 `tooSoon` within the 15 minutes, 502
    `mailFailed` (the link forgotten), 503 without the platform's mail. The manager's page gets 204 and nothing else.
    No audit row: Better Auth's tables aren't audited, and the email names who sent it.
  - **Only accounts with a second factor get a link** (the review's medium finding): for an account still to enrol (an
    invitation accepted, enrolment never finished; or an authenticator the owner just reset) a new password would let
    whoever reads the mailbox enrol their own authenticator. The forgot answer stays the same; Members says
    `notEnrolled` (409). Such a member who forgets their password has no way back but the owner: D19.
  - The set-password page's closing words now fit a reset as well as a first password.

  Tests: unit (the emails, the route allowlist), API database tests with the real Better Auth (same answer, language,
  a full reset with TOTP kept and sessions ended, the cooldown, requests at the same moment, an account still to enrol,
  a failed email, the visitor limit, the members' links), route tests (who may, 409/429/502/503), and e2e through the
  fake mailbox (the whole forgot flow in a second browser, an unknown address gets nothing, the members email, its
  cooldown and an unenrolled member, no button for an editor). Two existing tests changed with the feature: the auth
  test's list of hidden endpoints (the reset request is now exposed) and the members e2e's column headers (the new
  Account column). Changed after an adversarial review (nothing high; one medium, above): of links made at once the
  earliest goes out (two requests together had cancelled each other, two sends from Members had both gone out),
  sessions also ended inside the reset hook (Better Auth ends them after it, outside a transaction), the cooldown
  counts only link rows, the timing claim softened (a lookup's small difference remains), the form's message when the
  API has no mail, and two Spanish phrasings.

- **R171. Attested quotes in the cell editor** (C4, Dani's task 5; the database rules existed: R167 and before). Under
  each quote from a source without text, the cell page shows its screenshot or clip, its clip times for video and
  audio, and who attested it; editors attach a file and set the times while the cell is a draft, and any member
  attests or withdraws. New API routes: `PUT`/`GET …/quotes/:quote/attestation/file` (upload, download),
  `PATCH …/quotes/:quote` (clip times), `POST`/`DELETE …/quotes/:quote/attestation` (attest, withdraw). No migration,
  grant or function. Choices:
  - **What a file may be:** a PNG, JPEG or WebP screenshot, or an MP4 or WebM video or MP3, M4A, Ogg or WebM audio
    clip, up to 50 MB (the files table's limit), stored once per site by its hash as source copies are (the same bytes
    as another type are refused, `otherType`). Members download it, with a sandboxing policy, never rendered on the
    admin's origin, as source copies.
  - **Attesting names the version the attester read** (C14): words changed since are refused as stale, so nobody
    vouches for words they didn't see. Attesting isn't a change of content (no new version), so it works during
    review too; attaching a file or changing the times is one (it undoes an attestation, and makes whoever stored the
    file a contributor, as the form says before sending).
  - **Any member may withdraw an attestation**, not only its attester (the database allows it): a reviewer who finds
    the words don't match should be able to say so. Re-attaching the same bytes changes nothing.
  - **The screen says why someone can't attest** (they wrote the quote, or worked on or uploaded part of the draft,
    while four-eyes is on), from the draft's contributors and uploaders, which the API now returns; the database
    decides again.

  Tests: API database tests (attaching at the version, same bytes once, another type refused; attesting at the
  version, withdrawing; those who wrote or stored any of it refused by the database; clip times kept in order), route
  tests (refusals before a byte is read, the download's headers, the version), and e2e on a site of its own (an editor
  sets the times and attaches a screenshot and can't attest; a reviewer downloads it, attests and withdraws). Changed
  after an adversarial review (nothing high; one medium): the page flags an attestation that will lapse (its attester
  has since worked on the draft) and the checklist doesn't count it, so it isn't first found at publishing; the API
  refuses a file for a quote with text and times outside video or audio (they are published with the quote); the
  upload checks the version, the cell's state and the quote before reading a byte, and is limited to 30 an hour per
  member, as logos are; the form's own words for a refused type; downloads named with their extension; no public
  refetch for these draft-only writes. Known limit: storing bytes another member stored before reuses their file,
  which names them among the draft's uploaders (as for source copies), so they neither attest nor publish it.

- **R172. A "replaced" mark on a source** (D14, Dani's task 6; migration `replaced_sources`). A source's stored copy
  never changes and it can't be deleted once anything cites it or its text is extracted, so a newer version of a
  party's document is a source of its own and the old one stayed in every list and in the cell editor's choice. Now
  whoever writes sources (editors, country admins, platform admins) marks it replaced from its page (after a
  confirmation), once and for good:
  `source_documents.replaced_at`, set by the source's trigger at the transaction's time whatever the caller sends,
  never cleared or moved, never set on insert, allowed with the copy stored (it joins the extraction status and the
  archive as the columns that may still change). A replaced source takes no new quote and no new "No lo menciona"
  check, nor one moved to it; what cites it stays as it is, still matched, edited and published. Lists put it last and
  say "Replaced"; the cell editor leaves it out of its choices. One column grant (UPDATE to the admin role; members
  read it, the public never); ADR-0002 §6 says so. Choices: **checks too**, not only quotes (a check of an outdated
  document says nothing about the party's current one); **the mark only**, no link to the source that replaced it
  (the newer one is listed beside it; a link would be a second, unchecked claim); **a source without a copy can be
  marked too** (harmless, and such a source can still be edited or deleted instead). Tests first (database: the mark
  once, its time, never new, with a copy; no new quote, no quote moved, existing ones kept and edited; no new check;
  the matrix's column cases), API route tests (who may, once, listed last), e2e on a site of its own (mark from the
  page, listed last, not offered in the cell editor), and a publish test (a cell citing a replaced source still
  publishes). Mutation check `replaced-sources`: 9 of 9 killed. The data model and S5.3 updated. Changed after an
  adversarial review (nothing high or medium): a replaced source no longer reads "can be cited", the cell editor marks
  quotes and checks that rest on one, the publish test, and wording. Known limit: the rule reads the mark without
  locking the source, so a quote added in the very moment it is marked can still cite it (locking the row there would
  stop reviewers, whom RLS doesn't let lock a source, from attesting). A "not mentioned" resting only on a replaced
  document: D20.

- **R173. Party logos in the table image** (R162's follow-up, Dani's task 8). Each party's logo now stands beside its
  name in the whole-table picture, as the party and cell cards draw one: fitted into a box up to half as tall again as
  the name and twice as wide as it is tall (a wide logo stays legible, a square one doesn't grow), kept on every row
  once any party has one so the names still line up; the party column widens a little for it (up to 40% of the
  panel instead of 30%). The logos are part of the card's content, so of its hash: a new logo is a new picture. Only
  PNG and JPEG logos are drawn, as on the other cards; one that can't be read leaves its row without. A new probe
  (`table/logos`: a wide logo, none, a square one) and its four reference pictures, accepted with `pnpm cards:accept`;
  the other references didn't change. Samples: `packages/og/reference/table/logos.{1080x1080,1080x1350,1080x1920}.png`.
- **R174. Previewing a site through the admin** (D15, ADR-0005 option A, Dani's task 7). A site's members (any role) and
  platform admins open its public pages, as if open, at `/t/{slug}/preview/…` on the admin host, from a link on the
  site's dashboard; anyone else gets an empty 404, and a signed-out visitor the sign-in page. The admin asks the API
  whether the actor may open the tenant (the same rule as every admin page), then fetches the page from the web app
  inside the cluster, naming its preview host (`PREVIEW_HOST`, an in-cluster name no gateway routes) and the shared
  secret (`PREVIEW_TOKEN`, a sealed secret both apps read) in a header, with the root the page's links are built under.
  The web app's preview mode answers only with the token (32 printable characters or more, compared in constant time;
  without it every page there, `robots.txt` included, is a 404) and takes the root only from such a request (one to four
  lowercase segments). The admin strips the page's scripts and serves it with its own policy: `sandbox` with
  `allow-same-origin` only, so no script or form, nothing from elsewhere, never cached or indexed; the stylesheets and
  fonts come through `/preview-static/` (content-hashed files only), and the site's images through the preview itself,
  under its root. A redirect stays inside the preview, else the answer is a 404. The spike (ADR-0005, Decision): Next.js
  serves a path `assetPrefix` only in development, so the admin rewrites the page's `/_next/static/` instead; the web
  app's CSS names its fonts relatively. Two changes from the ADR's draft: the sandbox keeps the admin's origin (an
  opaque origin sent no cookie with the logos and refused the fonts), and the scripts are stripped rather than only
  refused. The web app's NetworkPolicy gains a rule for the admin's pods when the preview is on
  (`scripts/check-web-network-policy.mjs` checks it); both charts' `preview:` blocks are off by default. Gitops turns
  them on; the secret is sealed with `scripts/seal-preview-token-secret.sh`. ADR-0002 §15 and the public-site spec §2
  are amended. e2e: a member's preview (its headers, assets and HTML), a non-member's 404, a signed-out visitor sent to
  sign in, and the preview host without the token; unit tests for both routes. Changed after an adversarial review
  (nothing high or medium): `.` and `..` segments refused (Next resolves them first; this doesn't rely on it), a short
  or mistyped token turns the preview off on both sides, a redirect to an anchor of the home stays in the preview, stale
  comments. Not done: a banner saying the page is a preview (the admin's address and the bare page say it already; a
  low-impact decision).
- **R175. Copies by URL and archive snapshots, through a fetcher** (D13, Dani's task 9;
  [ADR-0007](adr/0007-fetching-copies-and-snapshots.md); migration `archive_jobs`). A third process from the API's
  image, `node dist/fetcher.js`, with no database login, no volume and no service-account token, fetches a source's URL
  for the API alone (a shared token, as the worker's, and a NetworkPolicy that admits only the API's pods): the public
  internet only, by its NetworkPolicy (DNS, then every address but the private, loopback, link-local, shared and
  multicast ranges, on ports 80 and 443) and in its own lookup (every address a name resolves to must be public, checked
  on the connection itself, so no rebinding; an address written in the URL too), http or https with no user name, at
  most 5 redirects each checked the same way, 8 seconds (10 at most) and 50 MB, a compressed body counted once decoded.
  On a source with a URL and no copy, "Fetch a copy from its address" stores what it gives exactly as an upload in the
  requester's name (so four-eyes counts them, D17), its type the site's or, for bytes declared only as bytes, what the
  first bytes show (a PDF or an image), any other type refused by the fetcher before it sends a byte, and only if the
  source still names the URL that was fetched; then extraction, as after any upload. Snapshots: the transaction that
  stores a copy of a source with a URL requests an `archive_source` job (one open per source, the migration's unique
  index; and, by the job rules, only with the copy stored, since until then the URL can change and a snapshot of another
  address would stay), as does "Ask for a snapshot"; the API asks the fetcher, which asks Save Page Now and waits up to
  5 minutes, then hands the worker the address at its new door, `POST /archives/{job}`, where the worker sets
  `archive_url` in the requester's name under its existing job scope and finishes the job, or finishes it without one.
  No new role, grant or definer function. A job whose handover was lost is asked for again when its sources are listed,
  after 15 minutes. The source page shows the snapshot, that it is awaited, that one is taken with the copy from a
  public archive, or a warning with the button (W12). Off until gitops turns it on (`fetcher.enabled` in the API chart);
  `scripts/seal-fetcher-token-secret.sh` seals the token and `scripts/seal-fetcher-archive-keys.sh` an archive.org
  account's S3 keys (optional, but without them the archive allows 200 captures a day). ADR-0002 (§2, threat T29), the
  data model §8 and the editorial workflow (S2.1, S4, W11, O1) are amended. Tests: the fetcher's address checks,
  redirects, limits and doors; the archive client against a fake archive; the API's routes with a fake fetcher (stored
  as the requester's upload, refusals before fetching, each failure's answer, the archive job); the worker's archive
  door; the database's one open archive job (mutation check `archive-jobs`: 3 of 3 killed). The fetcher needs no e2e:
  e2e can't reach the internet, and the fetcher refuses this machine's addresses. Changed after an adversarial review
  (one high, one medium): a compressed body that stalled or was cut off hung its fetch for good, taking the fetcher's
  places one by one (now read through `pipeline`, with the deadline on the body and a backstop just past it); a snapshot
  could be taken while the URL could still change, and the fetch route didn't check the URL again before attaching (both
  fixed as above); error tracking added trace headers to the fetcher's requests and kept their URLs in breadcrumbs (now
  neither); also a fetch's place is held until its bytes have left, control characters are dropped from file names (an
  upload's too), the fetcher's refusals of the API's secret are reported, the deadline is checked at startup, and the
  policy and the address check exclude a few more reserved ranges. D21 asks about the four-eyes count for bytes stored
  before.
- **R176. The scorecard's link preview invites, and shows no ratings** (asked by Dani: R148's card, the question, two
  counts and a legend for ratings it never showed, "makes no sense"; Dani chose the invitation over the table, which
  would bring back R162's worry about crawlers' caches). The overview card (`packages/og`) now shows the question large,
  each party as a chip with its logo (PNG or JPEG, as on the other cards) beside its short name, as large as fits up to
  the question's size, then "and # more" past the smallest size, and one line on the accent: "Mira la respuesta partido
  a partido, con sus fuentes" (i18n `share.invitation`). The counts, the legend and "Actualizado el …" are gone, so
  the card, and its URL, change only with the question, the parties and their logos: a rating never makes a shared link
  show something old. Three probes (`names`, `logos`, `many`) replace `legend`, with their reference pictures; the other
  templates' didn't change. The public-site spec §5.4 is amended.
- **R177. Share links under each election page's title** (asked by Dani: "we want to encourage people sharing on
  social media, should not we have social icons?"). Below the title of the scorecard, the methodology, the corrections
  log, each party, criterion and cell: "Compartir esta página", a plain link each to WhatsApp, Telegram, X, Facebook,
  Bluesky and LinkedIn's own share addresses (new tab, said to screen readers) and an email (`mailto:`), with the page's
  canonical address (the routing table's, never the host asked: the preview's shares the real address) and its title
  as its tab gives it; then, where the browser has them, the device's share sheet ("Compartir…": on a phone, every app
  it has) and "Copiar enlace", which says when it copied. The links work with no script and load nothing from any
  network until followed (no widget, no cookie; an e2e test checks every request stays on the site's host), so the
  site's CSP and its no-cookie rule are unchanged; the two buttons are a small client component that renders neither
  before hydration, last in the row so nothing moves. Icons inline in the text's colour, always beside the names:
  Simple Icons' marks (CC0 1.0, simple-icons 16.35.0) for the five it has, plain line marks for LinkedIn (withdrawn
  from Simple Icons at its request), email, the share sheet and copying. Mastodon has no share address common to its
  servers: copying or the share sheet serve it. Instagram and TikTok take no links: the download disclosure stays at
  the end, now "Descargar la imagen, para Instagram, TikTok o historias". The public-site spec §5.4 is amended.
- **R178. The site's own colour, on its pages and its images; parties' colours on the images** (asked by Dani: "the
  orange background I would like to be able to set it up in the admin, and it affect the site and the images"; "use the
  colors smartly"). Settings now has "Colour" (editorial workflow T1): country admins and platform admins pick the
  site's `accent` with a colour picker, see it behind the site's name with the text the site will write on it and its
  contrast, save it, or go back to the platform's orange; other members see which it is. The one name a site may set
  is `accent` (T1.2; the domain's `THEME_COLOURS`): the text on it is ink or paper, whichever reads better
  (`readableText`), and a colour on which neither reaches 4.5:1 is refused, by the form and by the API (a 422,
  `themeContrast`); the database already kept `#rrggbb` under lowercase names (`theme_is_colours`), and the RLS policy,
  `members_may_change` and the column grants already gave the column to country admins and platform admins, audited,
  with the public version moving: no migration, grant or function. The contrast rule lives in the domain and the API,
  as T1.1 says; the public site and the API read a stored theme through `readTheme`, which drops any colour it can't
  draw, so one written past the API falls back to the platform's. The site: every page's root (the shared layout and
  the coming-soon page) sets the preset's variables for `bg.accent`, `fg.onAccent` and `fg.accentOnInverse` (the
  accent as text on the dark surfaces only where it reads there, else their own text), so the header, the poster and
  everything drawn with those roles follow; the manifest's `theme_color` too. The images: every card's `CardTheme`
  takes the accent and its text (`cardTheme`), so each picture and its URL change with it; the canvas, where the
  ratings sit, and the ratings' own colours never change. On a dark accent a card takes the operator's logo for dark
  surfaces (`operator_logo_on_inverse`), since one made for the orange would vanish, or the line in words without
  one. Parties' colours, which the site already showed as a swatch beside their names: now on the images too, a
  square outlined in ink beside each party's name on the overview's chips, the table's rows and the criterion card's
  rows (an empty square for a party without one, once any has one, as on the site, so the names line up), and beside
  the name on the party's and the cell's cards; never in a rating's place, never alone. New probes (`overview/colours`,
  a dark accent; `criterion/colours`, `table/colours`) and colours added to `party/many-logos` and `cell/pending-logos`,
  with their reference pictures. `contrast.ts` moved from `packages/ui` to the domain (`site-theme.ts`), which the API
  can import; the UI re-exports it. Tests: the domain's rule, the UI's roles and variables, the cards' theme, the
  public home's theme, the settings writer (merge by name, audit, refusals by role) and route (lowercase, 400 for an
  unknown name or a malformed colour, 422 for an unreadable one, 403 for an editor), the web's cards and manifest,
  and an e2e test from the admin's form to the public page's variables and its share image's new address. The
  public-site spec §4 and the editorial workflow T1 are amended. Not done: the site icon the platform draws for a site
  without one keeps the orange (an upload replaces it); per-site logos still wait for uploads (R100). After an
  adversarial review (nothing high): what is drawn on the accent but isn't text (focus rings, the coming-soon page's
  rule and button border, its solid button, the ballot box's slot, the skip link's ring over the header) had stayed
  ink, about 1.5:1 on a navy accent, under the 3:1 WCAG 2.2 asks (SC 1.4.11). New roles carry them: `border.onAccent`
  and `bg.onAccent` (the ink or paper that reads on the accent), `fg.onAccentFill` (the other one, on that fill) and
  `fg.accentOnFill` (the accent as text there, on hover), all equal to today's look on the orange; a test holds every
  one to 3:1 or 4.5:1 for six accents from black to white. The web now checks a site's colours again as it loads them
  (`readTheme`), so one malformed value can't fail every page of the site. The colour sits in a `style` attribute,
  which the spec §7 now names as the one exception, with what moving to nonces (R126) would take. The form's reset
  only shows the platform's colour once the reset succeeded, and its contrast ratio follows the page's language
  (rounded down, so "4.5:1" never stands beside a refusal); `@aiontheballot/ui` lists the domain package as a
  dependency, since it now imports it at run time; and the e2e test checks that a refused colour is never sent.
  Left: an empty `{"accent": ""}` resets the colour like `null` (Fastify coerces it; the same actor may reset it), and
  a theme change doesn't pre-render the elections' link previews (pages render them as they are served; operator
  changes have the same gap).

- **R179. Two fixes for races the full test run showed** (R170 and R172's follow-ups). Of two password links made
  for one account at the same moment, the later-stamped one used to be held back; but written by two replicas, the
  stamps needn't follow the order the rows were written in, so both could go out (a test now writes them so). The
  check now takes its turn on the account's row (`FOR NO KEY UPDATE`, which a session being inserted for it doesn't
  wait for) and holds back a link whenever the account has another unused one, so the checks see each other's
  outcome: exactly one goes out, in any order. No new grant: `aiontheballot_auth` already updates `users`. And
  "Mark as replaced" removes its own section once done, which took its status line with it: it now says so in the
  page's announcer, which keeps focus, as other actions that remove their control do. Found by the review of this
  fix (nothing high or medium in it): the owner's reset of a lost authenticator (R156) left the account's unused
  password links working, though a link goes only to an account with its second factor (ADR-0002 §10); with the
  factor gone, whoever read the mailbox within the hour could set a password and enrol their own. The reset now
  forgets them in the same transaction (a test used one after a reset, and it worked until this fix). ADR-0002 §10
  and incidents §5a are amended. Left: if the one link let through can't be mailed, the other was already forgotten,
  so none goes out and the sender is told the email failed (as before).

- **R180. No empty square for a party without a colour** (Dani: the share images' party squares; R178's
  follow-up). A party without a colour had an empty outlined square beside its name, on the site (since R125) and on
  the share images, which read as an unticked checkbox. It now keeps the space blank, so names in a list or a table
  stay in line, only where some party has a colour (as the images already did), and a party's own page shows none
  at all. The reference pictures with colours are accepted again.
  And from the last review of R179 (nothing high or medium): the check of a password link now also reads, under the
  account's lock, whether its second factor is still there, so a link written just after the owner's reset of a
  lost authenticator (its sender having seen the factor a moment before) is forgotten rather than mailed; a test
  holds a reset's lock while such a link is written and checked, and fails on the previous check. The colour form's
  ratio has a unit test (Spanish comma, rounded down) and the e2e test checks that a failed reset leaves the site's
  colour, in the picker and the database. Left: on a dark site colour, the coming-soon page's ballot meets its slot
  in the same paper (decorative; no text or control depends on it); and a manager whose send loses that race is
  told "sent too recently" rather than "no second factor yet" (a retry says the latter).
- **R181. Per-election curtains: draft, preview, live** (Dani: "yes on the per election curtains", in place of the
  site-level A+, which only a site's first election could use). An election goes from draft to preview, where its
  site's members see it through the admin's preview as the public will while it is edited as a draft, and then live,
  once: public and change-controlled. Guarded in Postgres (migrations `election_status_preview` and
  `election_curtains`): a new value of `election_status`; the moves in `election_rules` (draft → preview → live, or
  draft → live; never back), going live's checks also on entering preview, and again on going live from it; a
  preview's structure edited, added to and deleted as a draft's (the four delete policies, slugs, the announcement);
  its cells published through the same review, each revision recording it (`published_in_preview`), which the
  corrections log leaves out; `went_live_at` set only on going live. A new login, `aiontheballot_preview` (ADR-0002
  §2, §7, §12 and the visibility rule amended, threat T30), reads exactly what `aiontheballot_web` reads (grants
  copied in the migration; a catalog test keeps them equal) under a `preview_read` policy beside each `public_read`
  one, which also admits elections in preview; it writes nothing and executes no function. The API serves its data
  under `/preview/tenants/…` only with the preview's secret (compared in constant time; 404 without it, 503 while
  `PREVIEW_DATABASE_URL` and `PREVIEW_TOKEN`, both or neither, are unset); the web app's preview mode reads it
  through loaders of its own, kept seconds, for its pages, share images and logos (logos' bytes under keys of their
  own; a share image, cached by the hash of what it shows, is never pre-rendered for it). A cell's public history
  starts from the version last published in preview, numbered 1 and with no note (`publicHistory`). The admin: "Abrir
  la vista previa" from a draft (the checklist, then a confirmation), "Hacer pública" from preview (the typed slug),
  a link to the election in the preview, and a preview's details, announcement, structure and logos edited as a
  draft's. Tests first: the RLS matrix gained the preview principal and two elections in preview (A's, announced, its
  first party with a logo; the inactive tenant's), the catalog tests the preview role, `preview.spec.ts` the rules,
  then API route and data tests, the web's loaders, and e2e: the two steps, and an election in preview seen in the
  admin's preview and not on the open site until it goes live. Mutation list `election-curtains`.
  `scripts/seal-preview-role-secret.sh` seals the role's password and URL for gitops.
  Decided (low impact): going straight from draft to live stays possible (today's flow, the seeds and the tests); the
  admin offers the preview first. An election in preview doesn't go back to draft and isn't deleted (its published
  cells are history). Entering preview needs what going live needs, checked again on going live, since edits in
  preview may undo it. A republish in preview still takes its change kind and note: the review is unchanged, and
  neither is ever shown. A cell withdrawn in preview shows nothing publicly until it is published again. An announced
  election's own row stays public through preview, as through draft. The preview's guard is a login of its own rather
  than a setting on the public role's connection, which anything running as that role could change. The migration
  requires the role (granting to a missing one fails), so it is provisioned first (gitops, Dani).
  Left: 14 entries of older mutation lists (cells, revalidate, signups-and-mail, site-settings, sources-and-worker,
  worker-handover) had gone stale before this run, their code having moved on; the two of reset-authenticator, which
  R179 made stale, are updated (and one for the password links added). The multi-field edit (Dani's yes) follows as
  R183.
  Changed after an adversarial review (nothing high; no way found for the public to read anything in preview): share
  images in the preview drew their parties' logos from the public's data and failed for a party of an election in
  preview (now read with the preview's access, and no longer pre-rendered for the preview); the admin's corrections
  log listed what was republished in preview (it now builds each cell's history with `publicHistory`, as the public
  site does, numbering included); the site's preview now shows the public's data rather than failing while the API
  has no preview configured (as during a rollout); a cell withdrawn in preview and published again after going live
  shows that version as its first, which `app.corrections_log` leaves out too, and a version carried over from
  preview is dated no earlier than the election went live; the view keeps its newest-first order; pages and the logo
  route take the preview's mode only from a request that also carries the secret (constant time); the API checks at
  startup that each login is the role its routes assume, and stops otherwise; the e2e test checks the election, not a
  party, is absent from the public home, and now uploads a logo in preview and fetches it and a share image through
  the preview; the cell editor says a note written in preview is never published, and the preview's confirmation says
  what can't be deleted. Left: a catalog test compares only the preview's policy names, the matrix their behaviour.
  And from a second review of those changes (nothing high or medium): a publish reads its election `FOR SHARE`, so
  going live waits for one in flight and it for going live (a test holds a go-live while a cell is published and
  checks the revision says it was published live; the freeze window's check gains the same); the home's share image
  isn't pre-rendered for the preview either; the fallback releases the answer it drops; the API's login check
  compares the login itself (`session_user`), not only the role it acts as, waits up to 5 seconds before listening,
  tries again while the database can't be reached, and sends its report before stopping; the e2e test waits until the
  new site is routed before checking its election is absent, then checks again after the preview was seen. Left: in
  the preview, a share image whose hash went stale redirects to the canonical address, where the preview stops (a 404
  there; the only redirect test reaches the seeded site through the preview host); an API older than the preview's
  routes answers the preview 404 for the minutes of a rollout; a note written for the first version after a
  withdrawal in preview is never shown, though the editor's hint says it goes to the log.
- **R182. The members page: a member's roles set in one dialog** (Dani: "that form looks ugly": each row held a
  select, an "Add role" button and a two-line reset button, laid out differently from row to row). Each row now shows
  its roles as labels, and, for those who manage members, two buttons: "Edit roles", which opens a dialog with a box
  per role, what each allows, and one Save, and "Reset password" (its full name for screen readers unchanged). The
  site's only country admin's box is checked and disabled, with the reason; unticking every box warns that the member
  loses the site. A save adds, then removes, through the existing role endpoints (no new API), so a member never
  passes through having no role; a refusal (say, the last country admin, removed meanwhile) is shown and the page
  reloads. On a phone, the email goes under the name and the buttons under the roles, the table keeping its
  semantics. The intro no longer says invitations aren't available (they are, below it, since R114). e2e rewritten
  for the dialog, with the same cases: cancelling changes nothing and gives focus back, a save announces itself and
  moves focus to the status line, the last country admin can't lose the role, a country admin can leave a site
  another still runs, Spanish. Decided (low impact): two buttons rather than a "⋯" menu (both in sight, no new
  component); name and email stay in their own columns.

- **R183. A live election's details changed as one request, whatever fields; the party form and its logo** (Dani:
  "did not we approve 'full form' and not atomic field by field changes?"; "it is very weird that I cannot upload the
  logo when creating the party"; admin forms §3, step 1). A change request may now be an update with no single field
  and a `proposed_value` that is an object of fields, a set: proposed with one public note, reviewed and applied as
  one (migration `change_sets`: two checks replace `change_requests_check`; `change_request_rules` takes only the
  target's updatable fields, records each one's value now, refuses the set once any of them changed, needs every
  text it changes in the default locale, and applies them in one update, where the logo trigger still takes only the
  site's public images; `change_control` lets through exactly the set's values). One field, an addition and a
  retirement stay as they were. The API takes a set as `values` beside `field: null`, each value checked as the
  draft's forms check it; a live party's next logo is uploaded first (`PUT …/parties/:id/proposed-logo`, the draft's
  checks, editors and country admins of a live election), stored in the site's public assets where nothing names it,
  so the public sees it only once a party does; members see any of the site's public images by id (`GET
/t/:tenant/images/:id`, PNG, JPEG or WebP only, sandboxed as a logo is). The public data names a set's fields
  (`fields`), with the values except a reviewer's (R26). The admin: "Proponer un cambio" on a live party opens the
  edit form, every field beside what it is now ("Ahora", then the field "(nuevo)"), each one that differs marked
  "Cambiado" in words, the logo with its own preview, one note; "Nada ha cambiado todavía" if nothing differs; only
  what differs is sent. The change list shows a set as a table (field, before, proposed; logos as images), and both
  corrections logs name its fields ("cambió su nombre corto, color y sitio web") and list the short ones' values.
  And the admin forms' first step (spec/admin-forms.md): `Field` (Ark's, label, hint, "(opcional)", its own error
  under it), `ImageField` (Ark's FileUpload: a drop zone and a button, the file previewed on a checkerboard before
  anything is sent, its type, size and sides checked in the browser, Replace, Remove and Undo; the form uploads it
  on save) and `ColourField` (no colour until someone picks one: "Elegir color", the picker beside a `#rrggbb` code,
  "Quitar color"). The party form uses all three, `noValidate`, says what is wrong at each field and moves focus to
  the first; a new party's logo is chosen with the rest and uploaded right after it is created ("Añadir partido",
  then "Partido añadido." on the list; if only the logo fails, its page says so). The party page: its logo, name and
  short name first, then its details (the form, or for a live party its details read-only with "Proponer un cambio"),
  its programme, and "Borrar" last; a save stays on the page with "Guardado." beside the button. The list shows each
  party's logo, short name and colour code, and in bold what it lacks (logo, colour, programme check). `LogoForm`
  is gone. An invitation's role is a radio with what each allows, Edición first and chosen (it was Coordinación, the
  most powerful). D18's note: the organization form says its tax id, address and registry entry are needed only for
  an organization that runs a site. Tests first: database tests, a matrix insert of a set per tenant, mutation
  list `change-sets`, API tests (a set's values and
  refusals, the logo uploaded, shown and applied, the public `fields`), the admin's value comparison, the public
  log's fields, and e2e (the party form with errors, colour and logo on create and edit; the edit of a live party's
  name, colour and logo in one request; the invitation's default role).
  Decided (low impact): the admin always sends a set, even of one field (one path to review; the API keeps the
  single-field form). On a draft party's page the logo is sent with Save, like its other fields, rather than when
  picked (the spec said "immediate on edit": one save is less surprising). A proposed logo whose request is withdrawn
  or rejected stays among the site's files, unpublished, as a replaced live logo does. The admin's CSP takes `blob:`
  images, which only its own scripts make, for the previews. Inputs show the error border only once marked invalid
  (`aria-invalid`), not on load (spec step 2's `_invalid` fix, done here since `Field` needs it). Radios and boxes
  no longer shrink below 24 px when their label wraps.
  Changed after an adversarial review (nothing high or medium; no way found to apply or approve anything a request
  didn't name exactly): an update of a retired row is refused, when proposed and when approved (it used to be
  approved, with a public record for a retired party); an approval lets through only the write that applies it,
  not a later one of the same value in its transaction (a direct write could then undo the next request's value
  while the log said otherwise; not reachable through the API); a set leaves out a field already at its value, and
  one that changes nothing is refused, so the public log lists only what changed and an unchanged field can't make
  it stale; the table's own check refuses an empty set or one with no value, also past the triggers; the admin
  treats an upload answered without the file's id as failed (it would have proposed removing the logo), and puts a
  file's name in its status line without reading it as a pattern. Tests for each, and for what the review found
  untested: a null text in a set, a methodology's and a reviewer's sets, a set refused to a reviewer, to its proposer
  where a second approver is needed and in the freeze window; the proposed logo refused for a draft and a retired
  party, and the images route for a source's copy and a non-member. The mutation list has 15 entries (11 killed, 4
  equivalent, each with its reason). Left: a replaced live logo's file, and a proposed one whose request is
  withdrawn or rejected, are kept (unpublished; up to 30 uploads an hour per member).

- **R184. A party's logo and colour** (Dani, on the canvas board "Logo y color: hoy y con la propuesta"). A party
  shows as its mark beside its name: its logo, without a frame, contained in a box of one size, so names line up;
  without a logo, a rounded square of its colour outlined in ink, with no mark (square, unlike the round rating
  icons); with neither, the box stays empty, and with no party in the list having either, there is no box at all. Its
  colour is also a thin line under its name. On the site (`PartyMark`, `PartyName` replace `PartySwatch` and
  `PartyLogo`): the scorecard's table and its cards, the criterion page's parties, the party page's heading (a 64 px
  box and a thicker line); on every share image that names a party (the overview's chips, the party, criterion and
  cell cards, the table; the criterion card now draws the parties' logos too); and in the admin's party list. Colours
  stay SVG fills or the images' own drawing, never a style attribute on the site (public-site spec §7). Reference
  pictures accepted again (`overview/colours`, `party/many-logos`, `criterion/colours`, `cell/pending-logos`,
  `table/logos`, `table/colours`); the criterion probe shows all three cases. The public-site spec §4 and §5 are
  amended. Sample renders, with fictional parties: <https://claude.ai/artifact/JSbuCV1RQAjVSE5Z4jdcRk> (private).
  Decided (low impact), after checking it as Dani asked: where the name is an underlined link (the table, the cards,
  the criterion page, the admin's list), the line under the name read as a second, coloured underline, so there it
  goes under the logo instead (its place kept under every mark, so they stand alike); a party with only a colour
  needs none, its square being the colour. On the party page's heading and on the images, where the name is no link,
  it stays under the name, as drawn. Making the colour the link's own underline was set aside: it would put a party's
  colour in a style attribute (the site's CSP rule) and a pale colour would hide the link.

- **R185. Sharing, data first** (Dani: "yes on the redesign", "the new cards are much better"; canvas boards A to D).
  One "Compartir" button under each election page's title, a disclosure that needs no script, opening a panel: first
  the data image (the page's own card, the whole table on the scorecard) in the square, portrait and story shapes,
  with a thumbnail, each downloadable and, where the device can take a file (phones), "Compartir la imagen", which
  hands the picture itself to its apps; then the link, copied first, the device's share sheet, and R177's plain links
  per network. It replaces R177's row of links and the download disclosure at the end of the page. The cards
  (`packages/og/src/data-cards.ts`): the scorecard's link preview is now every party's rating on every criterion
  (canvas A: the question large on the accent, a grid of icons under the criteria's short titles, the legend, the
  parties that don't fit as "and # more"); the whole table (B) writes each rating's words under its icon where they
  fit and numbers the criteria over narrow columns, keyed below; a party (C) is the question for one party, its mark
  and name, then each criterion's rating as a large icon and its words; a criterion (D) is "Criterio 3 de 6", its
  title and description, then each party's mark, names and rating, with the accent as a side panel on the link
  preview. Every data card says its data's date ("Datos del …", the newest rating shown, or "Aún sin valoraciones
  publicadas") and the site's address large; parties in the site's order. Reference pictures and probes replaced
  (`overview/grid`, `plain`, `colours`, `many`; `table/small`, `marks`, `colours`, `large`; `party/few`,
  `many-logos`, `colour`; `criterion/parties`, `marks`, `many`); the cell, methodology and corrections cards are
  unchanged. Tests: the cards' content and dates (web), the og invariants on every card at every size, and e2e (the
  panel's three shapes per page, the table's on the scorecard, its links and copying). The public-site spec §5.4 is
  rewritten. Renders: <https://claude.ai/artifact/JSbuCV1RQAjVSE5Z4jdcRk> (private; the second section).
  Decided (low impact): the boards' totals ("3 cumple · 2 parcial") are left out, as agreed (no totals, no
  ranking). Every new card keeps the site's name, the operator and the methodology's short address, small (BRIEF §3,
  invariant 4, which the boards left out). The link preview now carries ratings, so a crawler's cached copy can be
  older than the page (R176's worry): it says its date, and a new rating is a new picture under a new address. The
  scorecard's data image is the whole table (B); A is only its link preview. The party card names criteria by their
  full titles, as the board does. One footer for all four (C's board had a dark one). The criterion's side panel only
  on the landscape shape; the square, portrait and story shapes have the header on top. The rating words in the
  invariant test are matched whatever their case (the party card writes them in sentence case).

- **R186. The owner's link for a forgotten password with no second factor** (D19, decided by Dani: "build as
  recommended"). `create-account.js` looks the address up first. For an account with a password and no second
  factor (an invitation accepted and left at enrolment, or an authenticator the owner reset), it prints the account's
  id and a read-only query of its roles for the owner, and the identity check to make (incidents §5b: someone
  entitled to by those roles confirms the person by a channel the chapter already uses); then it asks for the address
  again and for `link` typed out, and prints a link that sets a new password. Making the link ends the account's
  sessions and forgets its earlier links; setting the password emails the account a notice, and the next sign-in
  leads to enrolment. The operator gives the link to the person directly, never through whoever asked nor to the
  mailbox. An account with a second factor, enrolled or only stored (as the reset of a lost authenticator counts
  one), is always refused: its person uses "I forgot my password" or a reset email from Members, or §5a. A new
  account and one with no password yet behave as before (the link and the platform-admin SQL), the name now asked
  only for a new one. It prints the account's id, never its address or name. As `aiontheballot_auth` with the grants
  it has: no new grant, role or function. The self-service recovery is unchanged (an email alone never gives a whole
  account). Runbook: incidents §5b (new), with §5's pointer; editorial workflow A5.5, ADR-0002 §9, §10 and T28
  amended. Tests first: the link only when asked and never for an account with a second factor, a stored one
  included (`findAccount`, `accountLink`); the reset's effect (sessions ended when the link is made, enrolment next,
  the link once); the notice (an account with no factor is told whoever signs in next sets one up, not to reset
  through its mailbox); and the command itself with piped answers (two addresses that differ, an answer other than
  `link`, the roles query and the link printed with no personal data, the refusal, a new account, a second run before
  a password, a new address with no name).
  - **Adversarial review** (read-only subagent), all fixed but one: the runbook now has the owner read the account's
    roles before anyone confirms the person, and the link handed over directly at an agreed moment; the "password
    changed" notice no longer tells an account with no factor that sign-in asks for a code nor sends it to a reset
    link; the old path prints the platform-admin SQL again; a stored factor with the flag off is counted, as the
    authenticator reset counts it; sessions end when the link is made, not only once it is used; ADR-0002 §9 and T28
    no longer contradict §10. **Left:** two operators running it at once for the same account each make a link, the
    later forgetting the earlier; the runbook has one operator, so not guarded.
  - **Also:** the first password of a new account, set through the command's link, now gets the "no authenticator
    yet" notice rather than one saying sign-in asks for a code.
  - **Second adversarial review**, all fixed: the printed roles query failed (Postgres read `'platform_admin'` as the
    role enum; it casts the role to text now, and a test runs the printed query as the owner); making the link now
    also clears the old password (Better Auth refuses a sign-in with none, and the link sets the new one), so nobody
    who knew it can enrol an authenticator before the person uses the link; the person's confirmer must be a country
    admin of every site where the account is a country admin, reached, like the person, by a channel the operator
    knows independently; a new address says it has no account before the name is asked for.

- **R187. "Not mentioned" ratings to check again after a document is replaced** (D20, decided by Dani: "warnings,
  not a rule"). A published "not mentioned" whose every checked document has since been marked replaced (D14), such
  as a party's earlier programme, says nothing about the newer version. The admin now says so, in words and a sign,
  and never refuses anything: on the election's overview (any status but draft), a list of those cells, each a link
  to its cell, with when its documents were replaced; on the party's page, under its programme, the same for that
  party; and in the cell editor, a notice when the draft is "not mentioned" and every document it was checked against
  is replaced ("check the new version before submitting it, or correct it if it is already published"). The API reads
  the list under RLS for any member (`GET /t/:tenant/e/:election/rechecks`: the current revision rated "not
  mentioned", at least one checked document and none current; retired parties and criteria left out). No migration,
  grant or function. Tests: the list (API, as a reviewer, filtered by party, another site's member sees nothing, a
  later rating takes it off), the editor's rule (unit: every checked document replaced, one current, none, another
  rating), and e2e (the notice in the cell editor). Also fixed: the admin's corrections log linked each cell by its
  slugs, where the admin's cell pages take ids, so its links answered an error; it links by id now (the API's entries
  carry the ids, tested).
  - **Adversarial review** (read-only subagent; no access findings: the list is read under RLS by the path's tenant),
    all fixed: the tests now publish a real second revision (a new rating, a withdrawal) rather than change the first,
    and retire the party and the criterion, so reading every revision instead of the current one, or keeping retired
    rows, fails them (checked by breaking each); the list's heading follows the page's outline (h2 on the overview, h4
    under the party's programme); Spanish wording; the unused party filter is gone (the party's page filters).

- **R188. The public site tries once more when the API drops a connection** (found watching R185's release). In the
  rollout, one public page answered 500: a web pod that had just started asked the API for an election over a
  kept-alive connection that an API pod shutting down closed ("other side closed"), and had no earlier copy to fall
  back on. The site's reads of the API (an election, a home, the brand images, the routing table) now go through
  `fetchApi`, which tries a GET once more when the connection closed before any answer, never after an answer
  (whatever its status) nor after its 5 seconds ran out. Form posts (signup, reports) are not retried. Tests: one
  more try after a dropped connection, only one, none after an answer or a time-out, the same headers each time. A
  read now takes up to 10 seconds when the first try's connection drops (20 for the preview's fallback).

- **R189. Every admin form says what is wrong at its field** (admin forms §3, step 2). The browser's own bubbles, in
  its language, and the one banner above the button ("⚠ Falta algo necesario") are gone from every form with fields:
  each is `noValidate`, checks what it can before sending (a value that is needed, an email address, a web address,
  a slug, a whole number within bounds, a box to tick, a text in at least one language) and says so under the field,
  in the page's language, marking it (`aria-invalid`, its message in its description) and moving focus to the first.
  A refusal from the API lands at its field too: the database's constraint, as before, now mapped to a field rather
  than to the banner's wording, or, new, the field of the request body the API's schema refused (`{error:
'invalid', field}`; never the value or the schema's words), so a too-long text or an out-of-range number is no longer
  a generic "not valid". The banner stays for what has no field (a stale page, no permission, a limit). Shared:
  `ui/checks.ts` (`checkValues`, `refusalProblem`, `constraintProblems`), `useProblems`, `problemText` and
  `admin.form.problems` (English and Spanish), on R183's `Field`. Forms: the election (new and details), criterion,
  methodology, reviewer, freeze and announcement forms; the organization, new site, analytics, retention and legal
  text forms and the invitation; the source form, the change request forms (one field and R183's set, through a
  shared `proposalProblems`) and the report's triage. The legal text's "publish" says a missing default language
  before its confirmation opens, not after; an announcement that needs the election's name says so at the box.
  Tests: the checks and where a refusal points (unit), the change requests' checks (unit), the write answer's field
  (unit), the API's schema refusal (unit, and through `/sites`), and e2e (an election's empty form and refused slugs,
  a reviewer's consent, an organization's legal name, a legal text without its default language, a change request
  without its note).
  - **Decided (low impact):** the cell editor's forms get the same in step 3, which reworks that page; a form with no
    field (a button) keeps the banner, its "something is missing" pointing to the checklist beside it. No error
    summary at the top of long forms: focus moves to the first problem and each field says its own, so a summary would
    say everything twice; to revisit if a form grows past one screen of fields.

- **R190. The cell editor keeps what is typed, asks before it is lost, and has one bar to save and submit** (admin
  forms §3, step 3). Typing a summary and then adding a quote warned "someone changed this cell" and offered a reload
  that lost the text: the quote moved the cell's version. Each change of a cell's content (a quote added or removed,
  clip times, an attestation or its screenshot, a checked document added or removed) and a save of the draft now
  answer with the version they left the cell at, read in their own transaction while it still holds the cell's lock;
  the page's action tells the draft's form, which, when it was loaded at the version the action was sent at (which
  the API checked under that lock), counts the new one as its own and keeps the text. A change by anyone else still
  warns, as before (C14). With unsaved edits, a link that would leave the page asks first (in the page's language; the
  browser's own question on closing or reloading). The draft's "Save draft" and "Submit for review" are now one bar at
  the bottom of the window while the draft's part of the page is in view, with the draft's state and "Unsaved changes"
  or "No unsaved changes" in words and a sign; submitting saves what is typed first, so what goes to review is what
  is on the screen, and the checklist says when it counts the saved draft rather than what is typed. And step 2 for
  the cell's own forms: the quote (a source chosen, 15 to 1,000 characters, said at the field), clip times, the
  checked document, a rejection's note and the draft's texts say what is wrong at their fields. Tests: the API's
  answers (route test), which change is the page's own (unit), which click leaves the page (unit), and e2e (a summary
  kept while a quote is added and removed, with no warning, checked to fail without the fix; leaving asks; a submit
  that saves first and is refused, the saved text kept).
  - **Decided (low impact):** the browser's back button isn't guarded (the history API gives no way to ask first);
    the bar's "Save draft" submits the form by its `form` attribute, the form's messages staying above, at its fields;
    "a published cell opens straight into an editable draft" (spec §2, cells) and the phone order of the source text
    are left for step 10, with the phone navigation.

- **R191. The invitations and the audit log fit a phone** (admin forms §3, step 4). At 390 px wide the invitations
  table pushed the page 158 px sideways and the audit log 153 px (WCAG 1.4.10). The invitations take the members'
  table's phone pattern (R182): the role, state and expiry columns go under the address, in words, the table keeping
  its semantics; addresses, row ids and stored values wrap anywhere rather than push the page. Tests: e2e at 390 px,
  both pages with no sideways scroll (checked to fail before the fix), the invitation's details under its address.

- **R192. One pattern for sections, actions and feedback; a slug field; one word for each thing** (admin forms §3,
  step 5). `FormActions`: each form's one primary button at the start of its line and what it just did ("Saved.")
  beside it, in a status line that takes focus, rather than in a muted line below or the page's announcer far away.
  `FormSection`: a page's parts with their heading and what each is for; a page's destructive actions (deleting a
  party, a criterion, a source or a methodology; anonymizing a report) in one block, last, set apart. Feedback: an
  edit stays on the page (the criterion and source forms no longer leave it), a create says so where it lands
  ("Election created.", "Criterion added.", "Source added."), and so does a deletion that leaves the page (a confirmed
  action with somewhere to go now announces its result there). `SlugField`: one label everywhere, "Nombre en la
  dirección" / "Address name" (it was "Identificador", "Slug" and "Nombre corto", the last also a party's short
  name); a new one follows the name as it is typed, without accents or case, until edited, and shows the public
  address it makes; for elections, parties, criteria, sites and the change requests that add parties or criteria.
  Wording (an audit, 54 Spanish and 31 English messages): reports are "mensajes" (not also "avisos" and "Réplicas y
  errores"); "Borrar" for records and "Quitar" for parts of them, a legal text's draft "Descartar"; "verificación en
  dos pasos" everywhere; "acreditar" for attesting; "Institución" for a reviewer's; a cell's "Versión 3" says "Editada
  3 veces"; no "base de datos", "ISO 3166", "Markdown", "gitops" or plan references; language names in lowercase
  mid-sentence in Spanish ("en español"); the new-site form's methodology kinds in sentence case. Tests: the slug a
  name makes (unit), e2e (the slug follows the name and shows its address; created, added and deleted said where
  they land); every existing e2e unchanged in what it checks.
  - **Decided (low impact):** the saved status has no ✓ sign (words only, as before); a site's slug keeps its own
    hint, which says it never changes; the election overview keeps its layout until step 6; the invitation page
    still doesn't name the site (it needs the site passed to the sign-in pages' texts: with step 10).

- **R193. An election's overview starts with where it stands** (admin forms §3, step 6). It was four forms with four
  primary buttons, the settings each with its own save, and the next step (preview, going live) below them, its
  checklist without links and naming parties by their address name. Now a status card comes first: the state in
  words, what it means, the next step, and its checklist, each missing item a link to where it is done (the
  methodology, the parties, the criteria, the details), with the step's button. Then the details, as one form; then
  the settings as switches that save as they are switched (the announcement; four-eyes for platform admins, which
  still asks before turning off), their state in words and a sign, "Saved." beside them, a refusal at the switch.
  The freeze window sits behind "Schedule a freeze" while there is none, its times named as the reader's time zone
  (the window's line names UTC). Archiving, which can't be undone, asks for the address name typed, as going live
  does, shown as code. A draft's delete, last, can't be pressed while the election has a methodology, parties,
  criteria or sources, and says so, rather than offering a delete that fails; it says "Election deleted." where it
  lands. Tests: e2e (the switches, the cancelled four-eyes, the checklist's link, the freeze's time zone, the typed
  archive, the disabled delete with its reason).
  - **Decided (low impact):** the checklist still names a party missing its name by its address name (it has no name
    in that language) and links to the parties' list; a switch is a button with `role="switch"` rather than Ark's
    Switch (no new dependency, and it keeps the one-line layout).

- **R194. A source's copy chosen with it, its language by name, and one view of its details** (admin forms §3,
  step 7). A source's copy needed a second page, through the browser's raw file input; its language was a code
  typed by hand; and its page showed every detail twice, as facts and then as the form. `FileField` (Ark's
  FileUpload, as R183's `ImageField`): a drop zone and a button, the chosen file as a line with its name, size and
  type, its type and size checked before anything is sent, Remove. Adding a source now asks for its copy as well:
  later, a file now, or fetched now from its address (where fetching is set up); what storing one means under
  four-eyes is said first, and the copy is stored right after the source is, the source kept if that fails and its
  page saying why. `LanguageSelect`: the site's languages by name, then others (the EU's and a few more), then any by
  its code. A source's page shows its facts once, with "Edit" while it has no copy, which puts the form in their
  place and focus in it, and "Stop editing", which brings them back; the copy's media type and SHA-256 sit behind
  "Technical details". Tests: e2e (the copy chosen and stored with the source, the file's line, a missing file and a
  refused type said at the field, the language's default, the edit toggle and its focus).
  - **Decided (low impact):** a source's extracted units ("§ 1", "p. 2") stay in sight, being how its text is read and
    quoted; only the media type and hash went behind the disclosure.

- **R195. A site's logos, an organization's logo and a site's details, from the admin** (admin forms §3, step 8). A
  script uploaded brand images and organization logos, and a site's name, languages and operator couldn't change once
  it existed. Now, on the existing grants and RLS (no new grant, role, policy or function):
  - **A site's logos**, slot by slot (R59, R72: on the site's colour, on white, on dark, the mark, the site icon): a
    "Logos" part of its settings, one `ImageField` per slot saying where its image shows, one "Save logos". Country
    admins and platform admins (`PUT`/`DELETE /t/:tenant/brand/:slot`: the type and the user's rate, then the role,
    checked before the body is read; the image checked by its own header as a party's logo is, at most 2 MB and 4,096
    px a side; stored in the site's public assets and selected, which the public site serves at once); every member
    sees them (`GET /t/:tenant/brand`, the images through `/t/:tenant/images/:id`). A replaced upload goes if nothing
    else names it, as a party's logo does; a slot that named one of the platform's images says so, and an upload of
    the site's own replaces it, the platform's image staying. The image checks are one helper now, shared with party
    logos.
  - **An organization's logo**, in its form, chosen and previewed with the rest and uploaded once the organization is
    saved: one of the platform's images (`brand_assets`, named neutrally; the same bytes already there are that image,
    a restricted one first, so only a PauseAI chapter takes it), its bytes in the platform's space; platform admins only
    (`PUT`/`GET`/`DELETE /organizations/:id/logo`). A replaced or removed logo's image stays in the catalogue, which may
    offer it to sites; the sweep keeps its bytes while a row names them.
  - **A site's details**, on its platform page: its name, its other languages and its operator (`PATCH /sites/:site`,
    platform admins, as `members_may_change` insists); its main language is shown and kept, since the public addresses
    are in its words. A new operator replaces the old link, or, already the site's endorser, becomes its operator; at
    commit the database checks the site still has one, and that restricted brand assets still go with a PauseAI
    chapter (said at the operator). A refusal the API makes itself may now name the body's field (`{error, field}`).
  - **Tests:** the routes (who may and may not, another site's member never, the image checks, a replaced file
    dropped, a platform image left as it is, the selection the public role then serves; the organization's logo in the
    platform's space, kept in the catalogue when removed; a site's details changed, its main language kept, each
    refusal at its field, checked to fail when the operator change is broken), and e2e (a country admin's logo saved
    and shown, an editor's read-only logos, an organization's logo, a site's name and languages).
  - **Decided (low impact):** a replaced organization logo's image is never deleted by the admin (it may be one the
    platform keeps for sites to choose); a slot that names a platform image can't be emptied from the site's settings
    (the platform set it), only replaced; the mark isn't drawn on the public site yet, and its hint says what it is for
    rather than where it shows. Three e2e locators became exact, as new labels share their words.
  - **Adversarial review** (read-only subagent: no new grant, policy or function needed; tenant isolation holds),
    fixed: an organization's logo whose bytes were a restricted brand asset made an unrestricted copy of it, which
    any site could then have selected (BRIEF invariant 5): it now is that restricted asset, which the database lets
    only a PauseAI chapter use, refused in words otherwise (`restrictedAsset`, tested both ways); the catalogue's
    names no longer carry an organization's legal name; the API, not only the form, refuses to empty a slot the
    platform set; the site icon is checked as T1.4 says (a square PNG, 512 to 1,024 px; `siteIcon`); changing a
    site's operator or taking a language away asks first, saying what changes; the editorial workflow (P2.3, P4, §14,
    W6) and ADR-0004 §4 (bytes are stored after the role and type checks, before the row) now say what the code does.
    **Left:** a country admin can store about 30 images an hour, kept 120 days once replaced (a per-site budget, if
    abuse ever shows); a brand upload whose bytes are a replaced party logo's of a decided change request shares its
    file row, which replacing the brand image would drop (`dropFileIfUnnamed` checks pending requests only; rare);
    brand images are cached for a year, so taking one down also needs a cache purge (as party logos); two
    simultaneous uploads to an empty slot leave the loser's file row unnamed until the sweep.

- **R196. Pickers, a Markdown preview, clip times as a clock has them, and triage in one step** (admin forms §3,
  step 9). A clip's start and end were decimal seconds typed into number fields; they are now written and shown as
  minutes and seconds (`1:23`, `1:23.5`, `1:02:03` past an hour), a time no clock says refused at its field. A
  report's triage was a select that went new, then triaged, then a decision, two saves: it is now radios, each saying
  what it means, and a decision can be taken from "new" at once (the API moves it through triage in the same
  transaction, so the database's rule, new → triaged → decided, and its stamp of who triaged it stand); the report's
  page links to its election's change requests, whose forms name the report a change answers. A new site's country
  is chosen by its name in the admin's language (ISO 3166-1's codes, named by the browser; a demonstration site's
  codes, XA to XZ but XK, apart). The methodology and the legal texts are Markdown: their fields grow with what is
  typed and show, per language, a preview rendered by the public site's own renderer (moved to `packages/domain`,
  which both now import: raw HTML escaped, only http(s) and mailto links). Tests: the clip times (unit, both ways),
  deciding from new (API: triaged and decided at once, stamped; a decided report stays so), e2e (a time refused and
  one taken, as minutes and seconds; deciding at once, each choice's meaning; the country by name; the preview, raw
  HTML shown as text).
  - **Not built, a question for Dani:** the territory picker (§1.6). Choosing a subdivision by name needs a list of
    ISO 3166-2 subdivisions and their names, which browsers don't have: a data package (a new dependency) or a table
    the platform keeps. Recommendation: a small, vetted dataset package, pinned, read only by the admin's pickers;
    until then the field keeps its codes, now explained in words (R192).

- **R197. The admin on a phone: one row of sections each, and every target a fingertip's** (admin forms §3, step
  10). At 390 px the site's sections and an election's eight took about 600 px in rows before any content. Each row
  of sections is now one line that scrolls sideways on a phone (from a tablet on, it wraps as before), brought to the
  section the page is in; links keep their 44 px height. The text buttons ("Sign out", "Use a recovery code", the
  language switch) were 24 px tall: 44 now (WCAG 2.5.8's 24 px is the floor; the rest of the admin already has 44).
  Checkboxes and radios never shrink below 24 px (R183). And, left from step 3 (R190): a published cell no longer
  opens straight into an editable draft; it says it is published and that a change goes through review again, and
  "Correct or update it" opens the editor, focus in it. Tests: e2e at 390 px on an election's last section (each row
  one line, the current section in view, no sideways scroll for the page, "Sign out" 44 px tall; checked to fail
  before the fix); a published cell behind its step.
  - **Decided (low impact):** on a phone the source's text stays after the quote form (R190 left it here): the source
    is chosen in the form, so the text above it would come apart from that choice, and the page's order would no
    longer be its reading order; "Use this passage" already brings focus back to the quote.
  - **Not built, a question for Dani:** the invitation page naming the site (R192 left it here). The page reads a
    pending invitation through `private.pending_invitation`, a `SECURITY DEFINER` function that returns its email and
    role only; naming the site means it returns the site's name too, a definer function change (ADR-0002 §10).
    Recommendation: return the site's display name, which its members and public already see, nothing else.

- **R198. A release's image builds try again when the builder interrupts them** (Dani: "ok", to the brief's question
  4). Two releases (R190's and R194's) stopped building images: turbo, inside the image build, couldn't create a
  package's log folder ("Interrupted system call"), with no cache involved, so keeping `.turbo` out of the build
  context wouldn't have helped; the next release built them both times. The release workflow now tries the build and
  push again when it fails, three times in all (BuildKit's layer cache makes a retry quick); a build that is really
  broken fails all three and stops the release as before, with a warning for each failed attempt. Checked: the
  workflow's YAML and shell, and the retry loop simulated under `set -e` (a first try, a third, and three failures).

- **R199. The invitation page names the site it invites to** (Dani: "ok", to the brief's question 2; admin forms §2,
  members and invitations; R197 left it). Migration `invitation_site_name`: `private.pending_invitation` also returns
  the invited site's display name, in every language it has, and its main language; same argument, owner, search path
  and grant, the function dropped and created again since its result grew (ADR-0002 §10 amended). Nothing else of the
  site, and only the invitation's own, which its email named already. The API's lookup passes it on, and the page says
  "This invitation is for {email}, to work on {site} as {role}": the name in the page's language when the site has
  one, else in its main language, else in any it has (nothing in the database makes a name include the main
  language), marked with its language when that isn't the page's. An answer with no site, from an API older than this
  while a release rolls out, gets the old sentence instead of breaking the page. Tests first: the database (the lookup
  names its own site, A's and B's; an accepted invitation no longer named), the API (the lookup's site), the admin
  (which language the name is shown in), e2e (the page names it); mutations (`invitations.json`: every site named, an
  expired, revoked or accepted invitation still named, the lookup granted to every role: each fails a test; four older
  entries marked equivalent, two superseded by this migration, two whose rule a later check keeps). The adversarial
  review found nothing high; its findings fixed: the missing site and the name's language above, and the ADR's
  wording on what the lookup reads and returns. Left as is: an old pod's lookup parsed in the instant the migration
  swaps the function may fail once.

- **R200. The same image is never both a restricted brand asset and an unrestricted one** (Dani: "if you really
  think it is a must, ok", to the brief's question 3; the review of R195; BRIEF invariant 5, T17). The database lets
  only a PauseAI chapter use a restricted asset (`restricted_assets_are_eligible`); an unrestricted copy of its bytes
  was the one way around that, and a restricted copy of an unrestricted image would leave the original usable by
  anyone. Migration `brand_asset_one_restriction`: a transaction that leaves some bytes stored both restricted and
  not is refused at commit, whoever writes it, the owner's scripts included (rows inserted so, changed to the other
  restriction, or given another's bytes). Copies of the same restriction stay possible, and a group of copies can
  change its restriction together. One check at a time per image (an advisory lock, taken when the check runs, at
  commit unless `SET CONSTRAINTS` runs it sooner, and held to the transaction's end), and only under read committed:
  under repeatable read or serializable a write is refused, since the check could miss a row committed meanwhile.
  The migration refuses to run while an image is already stored both ways, as `files_on_volume` refuses to lose
  bytes (none is expected: the admin made no such pair, R195 reusing the restricted asset). Should it refuse, this
  read-only query lists each such image, its assets restricted ones last:

  ```sql
  SELECT a.sha256, array_agg(a.id ORDER BY a.restricted) AS assets
    FROM app.brand_assets a
   GROUP BY a.sha256
  HAVING count(DISTINCT a.restricted) > 1;
  ```

  The owner settles each by keeping one restriction: pointing what uses the others (`organizations.logo_asset_id`,
  `tenant_brand_selections`, `brand_asset_grants`) at a kept asset, deleting the others, and deploying again. No
  grant, role or definer function. Setting an organization's logo reuses a restricted image of the same bytes, and
  is refused (409, `otherType`) when that image's row gives the bytes another type, which serving them as would
  break. Tests first: the database (both copies refused, by the platform admin and outside any role; same-restriction
  copies allowed but neither then restricted alone; a group changed together; an asset with no copy changing its
  restriction; another's bytes taken by a change; a second writer waiting for the first's check and then refused by
  its commit; repeatable read and serializable refused; the migration's guard), the API (a restricted logo labelled
  with another type refused); mutations (`restricted-assets.json`: eleven broken, each failing a test). The
  adversarial review found nothing high; it found the guard missing (only promised in this entry), the lock untested
  and blind under repeatable read, a group of copies unable to change together and a deadlock possible between the
  row check and its lock (gone with the check at commit for a transaction touching one image, as the API's do; an
  owner's script touching several can still deadlock, which Postgres breaks), and the logo's lookup missing a
  restricted image labelled with another type: all fixed above. Its re-review found the race test proving only that
  the second writer waits (now it commits the first), a test the eligibility rule passed for this one, the query
  this entry promised, a logo that would be served as the wrong type, and wording: all fixed.

- **R201. Territories chosen by name, not typed as codes** (Dani: "ok", after the brief's plain explanation of
  question 1; admin forms §1.6 and step 9, R196's question). The admin's forms list the site's country's subdivisions
  from ISO 3166-2, as the `iso-3166` package (4.4.0, MIT, pinned) gives them, read on the server so a page sends only
  its country's. A party's territories, in its form and in a change request, are ticked: those directly under the
  country by name, each with the ones inside it folded under it (a community's provinces; a French region's
  departments too), open where one is ticked, a box finding any by name or code whatever its accents, Enter there
  finding rather than sending, and the codes chosen listed in words. An election's territory is a select, grouped the
  same way, its empty choice "the whole country" or, for a regional one, "choose a territory". The form still sends
  the codes as before, so the API and the database check them unchanged; a code saved before that the list hasn't
  stays ticked, kept unless unticked. A country with no subdivisions in the list, as the demo and test sites' XA to
  XZ, keeps the code field. Place names are proper names, shown as ISO writes them, with no `lang`. A party's facts
  show each territory's name beside its code. Decided: the list is the package's, so a new version changes it only
  on purpose; no table of territories to keep. Tests first: the list (no subdivisions for codes kept for private use;
  for every country, only its own codes, of the shape the database takes, each inside one listed), the groups and
  the finding (unit), and e2e (a regional election's territory chosen and needed; a party's ticked, found, saved and
  opened again; a live party's ticked in a change request and marked as changed).

- **R202. A member's tokens for tools, in the database** (Dani: "i want to start now", choosing each
  recommendation: an MCP server on their machine, a personal token, refused in the API and the database, named in
  the audit log; [ADR-0008](adr/0008-member-tokens-for-tools.md)). The first of three releases bringing forward
  "Later: an MCP server", to bootstrap the 29 November general election's parties. `auth.member_tokens` keeps a
  token's SHA-256, its name, member and minting session: minted only from a live aal2 session of that member whose
  second factor exists and was verified, dated by the database, 30 days at most; only `last_used_at` and
  `revoked_at` change, stamped by the database, a revocation is never undone, and Better Auth's role (the only one
  granted) can't delete one. A password set, changed or removed, or a second factor removed, revokes every token of
  the member and ends their sessions in the same transaction; a second factor enrolled again revokes them only.
  Minting queues behind such a change on the account's row, so neither a token being minted nor a session opened
  before it gets past it. Through a token (`app.token_id`, set by the API as `app.user_id` is),
  `private.needs_a_person` refuses every write on every table but what drafting needs: an election's own details
  (never its status, announcement, freeze or second-reviewer rule, nor deleting it), its parties (never whether a
  programme is published), logo files, proposed changes and withdrawing them (never deciding), and the audit log and
  public cache the database writes itself; a catalog test keeps a new table closed to tokens until listed. The
  re-review closed what remained: no change at all to an election the public sees (announced or live), logo files
  only, withdrawing only the member's own changes, and the owner's reset of an authenticator counting the sessions
  it ends before its factor goes (whose removal now ends any left).
  `audit_log.token_id`, written by `private.audit` (its body changed; no new definer function or grant), names the
  token beside its member, by id only. The adversarial review found the first version listed decisions instead (it
  missed opening a site, attesting, policy texts, report retention and more), a race letting a token outlive a
  password reset, an unverified second factor accepted, dates taken as given and the token's name in the audit log:
  all fixed as above. Decided (low impact): the table lives in `auth` beside Better Auth's, which the schema
  comparison leaves out by name; minting and revoking are recorded in the table, not the audit log. Tests first
  (43, including a mint and a password change racing on two connections, in both orders; the catalog's grants and
  uuid columns, the export's credential-like columns); mutation list `member-tokens`. Still to come: R203 (the API
  reads a token, on an allowlist of routes; the admin's page to mint, list and revoke) and R204 (the MCP server).

- **R203. A member's tokens for tools, in the API and the admin** ([ADR-0008](adr/0008-member-tokens-for-tools.md);
  the second of three). A request carrying `Authorization: Bearer <token>` and no cookie acts as the token's member
  at aal2, if the token is unrevoked, unexpired and its member still enrolled; `withActor` then sets `app.token_id`
  (always set, empty without a token, so nothing earlier on a pooled connection stands in for it). A hook refuses a
  token, before the request is read, on every admin route but `TOKEN_ROUTES`: reading the member's sites, elections
  and parties; creating an election; creating, editing and ordering an election's parties and their logos; proposing
  a change to a live one and withdrawing it. A token request carries no cookie, so the Origin check (for a browser's
  writes) doesn't apply to it; a token beside a cookie stands for no one. Tokens are minted, listed and revoked only
  from the member's session with the admin's Origin, never through a token: `/api/tokens`. A token is
  `aiontheballot_` and 32 random bytes (a prefix secret scanners can match), shown once; its `last_used_at` is
  updated at most once a minute. The admin's "Tokens for tools" page ("Claves para herramientas"; linked beside
  "Sign out" and from the home page) says what a token lets a tool do and not do, creates one (what it's for, 1 to
  30 days), shows it once to copy, and lists the member's tokens with when each was created, expires and was last
  used, revoking an active one behind a confirmation. Decided (low impact): at most 5 active tokens per member and 10
  minted an hour; the list keeps revoked and expired ones for 30 days; refusals in the admin's existing words
  (`invalid` with the field, `limit`); the status (active, expired, revoked) by the database's clock; Spanish says
  "clave de acceso", not "token". The owner's authenticator reset counts sessions before removing the factor (fixed
  with R202's types, d384eb9, after CI found the Kysely types behind the schema: local `pnpm verify` doesn't check
  that drift). Tests first: `withActor`'s token; every admin route but the listed ones refuses a token, the listed
  ones exist; drafting a party through a token with no Origin; a change applied at once refused by the database;
  minting, listing, revoking, a cookie beside a token, a malformed or revoked token, a password change; e2e (created
  on the page, used by a tool, refused off its routes, revoked). The adversarial review found the API's tests had run
  against a stale build of `@aiontheballot/db` (rebuilt without the token while R203 was set aside), so a country
  admin's token had proposed and approved a change at once; the database refuses it once `app.token_id` reaches it.
  Fixed: the API refuses `apply` from a token itself too (`notForTokens`), and a test reads the token's id back from
  the audit log, so a broken or stale `withActor` fails loudly; more routes exercised through a token (editing,
  ordering, a logo, an election, HEAD, a live party refused); the page no longer promises the token's name in the
  history (its id is kept); a session ended mid-mint answers 401, not 500; the five-token cap has its own words
  (`tooManyTokens`: revoke one first); the page is a 404 where tokens are off; the scheme is case-insensitive.
  Mutation list `member-token-routes` (15 of 15).

- **R204. The MCP server** ([ADR-0008](adr/0008-member-tokens-for-tools.md); the last of three). `packages/mcp`
  (`@aiontheballot/mcp`, never deployed): an MCP server over stdio, built on the official SDK
  (`@modelcontextprotocol/sdk` 1.32.1, MIT, past the three-day wait), that a member's AI tool starts on their machine
  with the admin's address and their token in its environment. Its tools are the routes a token may reach: sites,
  elections and parties read; an election created (a draft); a party created, updated (the fields given, the rest
  kept), reordered, and its logo set from the member's logos folder; changes to a live election or its parties listed,
  proposed and withdrawn. A refusal comes back with the admin's key and what to do about it. It speaks to the admin
  over HTTPS only (plain HTTP only to this machine), follows no redirect (one could take the token elsewhere), sends
  no cookie, checks a logo here as the admin will (PNG, JPEG or WebP by its bytes, 2 MB at most; an SVG refused with a
  hint to turn it into a PNG), and escapes every name it puts in a path. Setup in its README: build, mint a token in
  the admin, `claude mcp add` with the two variables. Decided (low impact): the SDK rather than our own JSON-RPC, for
  a protocol that changes; tools only for drafting parties, as the database allows, nothing for cells or sources yet;
  colours sent in lower case. Tests: the settings (HTTPS, the token's shape), the client (token sent, no redirect,
  refusals), the logo checks, the tools through an MCP client in memory (the list, an update merged, a refusal in
  words, names escaped); e2e: a token minted on the page, the built server started as a tool would, an election, a
  party and its logo created through it, an SVG kept on the machine. The adversarial review found: a logo could be any
  image file the member can read, so an AI told by a page to upload a screenshot would; now only files in the folder
  the member sets aside (`AIONTHEBALLOT_LOGO_DIR`, links resolved first), sent as `logo.png`; changes could be
  proposed to criteria and the methodology, whose words are the chapter's: now parties and the election only, with
  "never invent" and "the note is published" in the tools' words; the README put the token in the shell's history: it
  is read silently now; `..` as a site or election reached another route: short names only; a website could be any
  URL: http(s) only; a reorder checked against a fresh read: against the order the AI saw; and the README says answers
  are data, never instructions, that an update can overwrite a person's edit made at the same moment, and never to let
  a tool upload or propose without asking. The e2e harness fails fast on a dead server or a stray line on stdout; the
  built file is executable.
- **R205. The operator's infrastructure stays out of this public repository** (Dani: "i do not want information about
  my infra leaked in a public repo"). The repository says what the app needs and supports, never what the operator
  runs, where, or how well it is protected; the deployment's specifics live in gitops and in the gitignored `.env`.
  The rule is a non-negotiable in CLAUDE.md, and the ADRs, this plan, the runbooks, the charts' comments, code
  comments and changelogs now follow it. The runbooks' commands take their cluster, namespaces and database pod from
  settings (`KUBE_CONTEXT` and the rest, runbooks README) loaded from `.env`; the seal scripts and
  `scripts/watch-release.sh` read theirs the same way (`scripts/lib/settings.sh`), with no default that names the
  cluster, and stop naming the setting they miss; dry runs against a throwaway certificate sealed the same secrets as
  before (names, namespaces, keys, annotations). CI asks for the self-hosted runner by generic labels; the release
  masks the registry's host from its first step and installs a pinned buildx itself, since the setup action printed
  the host's details into the public log. `scripts/check-private-terms.sh` fails when a term of a private
  list (`PRIVATE_TERMS`, from `.env`, or the repository secret of that name in CI) appears in the working tree, or in
  the files or message of any commit being pushed; it runs in the pre-push hook, first in `pnpm verify`, and in CI,
  prints where in a local run and only how many in CI, and fails on an error rather than passing. Without the list it
  checks nothing, so a contributor's run passes; CI checks only with the secret (R209). Decided (low impact): the error
  tracker and Plausible stay named where they are the app's integrations; the charts' `backup.velero.io` annotation
  keys, the resources they render and their `local-path` default stay, since they work; the secrets keep their names
  in gitops, so rotating one doesn't rename it; the runbooks read settings rather than move to gitops, so they stay
  next to the code they run. The adversarial review found: the guard passed with no list and nothing ran it before a
  push; it read the working tree, not what is pushed; a failure in CI would have shown where, and so which word, in a
  public log; this entry first described what had been exposed; several plans had been rewritten as facts (backups
  that copy the volume); the proxy contingency pointed at steps nowhere; and the gateway check listed no pods. All
  fixed as above, the plans restated as requirements, and the steps back in the incidents runbook.
- **R206. The API's image without Next.js, Playwright and Vitest.** better-auth lists framework integrations
  (Next.js, React, Vitest, Svelte, Vue…) as optional peers, and pnpm fills the ones the workspace has, so
  `pnpm deploy --prod` copied the web apps' Next.js (and Playwright, a peer of Next.js) and Vitest into the API's
  image, which uses none of them: the API imports only `better-auth`, `better-auth/crypto`,
  `better-auth/db/migration` and `better-auth/plugins/two-factor`. Overrides in `pnpm-workspace.yaml` drop `next`,
  `react`, `react-dom` and `vitest` from better-auth's peers (`'-'`); `pg` stays. The image went from 992 MB to 535 MB,
  and from 206 MB to 114 MB compressed, which is what each release uploads; React stays, at 1 MB, through the i18n
  package. In the new image each of those entry points imports and the server starts, and `pnpm peers check` shows
  nothing new. The shared lockfile marks every deployable, so web, admin and migrations are released too, unchanged.
- **R207. Sealing the registry pull secret alone.** When the registry stops accepting the pull secret, the cluster
  can't pull a release's images, and the only script that sealed it also regenerates the five database passwords.
  `scripts/seal-registry-pull-secret.sh` replaces the pull secret alone, with the same file, header and sync wave,
  after checking it with the registry's token service as the cluster will: a token request without a scope, which
  a wrong secret or a lapsed robot answers with 401, then one for pulling the migrations image, whose token must be
  the robot's and grant pull. The secret reaches curl and jq through stdin and kubectl through `/dev/fd`, never argv
  or the environment; curl ignores `~/.curlrc`, uses HTTPS only and sends the credentials only to the registry's own
  host; a stand-in for the check (`REGISTRY_CHECK_URL`) seals only against a throwaway certificate. A dry run against
  a stand-in that answers as the registry's token service does covered a wrong secret, a robot without pull rights,
  a token service on another host, a missing file, `CHECK_ONLY`, and a secret with `"`,
  `\` and `$`, which unsealed unchanged; a wrong secret against the real registry was refused. The incidents runbook
  sends a 401 on pulling there (§3), and a leaked pull secret too (§6). The adversarial review found: with a scope,
  the token service answers a wrong secret with an anonymous token, which the first version took for a robot without
  pull rights (or, on a project open to anonymous pulls, for a good secret); a missing `jq` sealed an empty config and
  reported success (in `scripts/seal-gitops-secrets.sh` too); curl's config quoting dropped a `"` or `\`; and
  `~/.curlrc`, a trace or a realm on another host could expose the secret. Its second pass found: the token's subject
  matched any tail of the robot's name; a secret the caller's shell exported stayed exported to the tools; a check
  sent to a stand-in could still seal for real; macOS's `python3` stub broke the check (jq decodes the token now);
  and `scripts/seal-gitops-secrets.sh` was only partly fixed. All fixed as above: both scripts check their tools
  first, turn tracing off, unexport the secret, build the config before sealing and check what they sealed.
- **R208. The security audit (M5): faults, unknown routes, the admin's error relay, local Postgres.** A read-only
  audit of headers and CSP (the live sites against the config), cookies and sessions, dependencies (`pnpm audit`),
  secrets (the tree, every commit, images, client bundles, error tracking), and in passing the fetcher's SSRF guard,
  uploads, redirects and authorization. Nothing high or medium; live headers match the config, and no secret was ever
  committed. Fixed, each test first:
  - **A fault's message reached the client.** Routes outside `signedIn`'s catch (a tool's token checked against its
    database, say) fell through to Fastify's own handler, which sends the message: a connection error names an
    address, a query's error can quote what was written. A root error handler now answers `unexpected`, reporting the
    fault as `signedIn` does (an error with a code by that code only); a refusal, by the error's status or the
    reply's, keeps Fastify's answer. Sentry's Fastify integration also reported every 5xx as thrown, message and
    all: the API server turns its reports off (`API_TRACKING`), so the handler's is the only one.
  - **`/api`'s unknown routes skipped its headers** (no `nosniff`, CSP, CORP or `no-store`, and Fastify's message
    naming the method and path): the scope has its own 404 now, `{ error: 'Not found' }`, after its hook.
  - **The admin's error relay had no limit**, though ADR-0003 §7 said it shared one: the admin chart has the web
    chart's `errorRelay` per-address limit now (off by default, set in gitops; on the launch checklist), and both
    relays refuse what a browser marks as sent from any other origin (`Sec-Fetch-Site`), which stops another site's
    pages flooding the error tracker with forged reports. Items are still forwarded as sent.
  - **Local Postgres listened on every interface**, with the public default passwords: `compose.yaml` binds it to
    `127.0.0.1`.
  - **`fflate` 0.7.3** (moderate, a loop in `unzipSync` on a malformed ZIP64 archive), which satori pins for the
    share images: nothing calls `unzipSync`, but an override takes 0.7.5, the fix, a patch release of the same line;
    the share images' tests pass with it, and `pnpm audit --prod` finds nothing.

  Decided (low impact): the development tools' advisories (`braces`, `smol-toml`, `katex`, through kysely-codegen and
  markdownlint) read only the repository's own files. Input for the open CSP question (nonces on the public site, R126):
  its pages are already rendered per request and `no-store`, so nonces with `'strict-dynamic'` would work as in the
  admin, except under the CDN-proxy contingency, which would cache the HTML with its nonce; the only HTML sinks are the
  Markdown renderer (no HTML, images, or links but http(s) and mailto). A `report-to` for CSP violations (R145) is still
  to do. The adversarial review found: the relay's test didn't type-check; Sentry's integration still reported the raw
  error, and twice; the first draft of this entry said `fflate` 0.7.5 was never published (it was); a `throw null`, or a
  refusal carrying only `status`, became a 500; and the runbook and ADR-0001 named only the web chart's limits. All
  fixed as above.

- **R209. The private terms stay on the operator's machine.** Dani decided not to give CI the list of private
  terms as a repository secret: the pre-push hook checks each push from their machine against the list in `.env`. A
  linked git worktree, which has no `.env`, now reads the main checkout's (`scripts/lib/settings.sh`), so a push from
  one is checked too. The CI step stays and checks only if a `PRIVATE_TERMS` secret is ever set; it no longer warns on
  every run. Not checked: a push from another machine or with `--no-verify`, an edit in GitHub's web editor, and a
  pull request merged on GitHub. A shell that exports `REQUIRE_PRIVATE_TERMS=true` makes the check fail, rather than
  pass, when it finds no list. The adversarial review found the worktree gap and loose wording, both fixed; and, if
  the secret is ever set, a force-push to `main` would fail the CI step on the missing base (left as it is).

- **R210. The public history restarts from the released tree.** Dani approved restarting this repository's history,
  whose older commits predate R205. One root commit holds exactly the tree that was tested, released and running; it
  replaced `main` with a lease on the old tip, and the operator keeps a copy of the old history. That one push skipped
  the pre-push hook and CI (`[skip ci]`), whose changeset and release checks compare with the previous tip, which a
  restarted history shares no commit with; the tree had passed `pnpm verify`, and the private-terms check passed on
  the root commit with the list required. The release tags (markers only: the release reads versions from the
  umbrella chart) were deleted, not recreated, and the Actions caches cleared; Argo CD synced the root with nothing to
  change. Left to the operator: deleting the old workflow runs. GitHub still serves the old commits by SHA, reachable
  from the closed pull requests, the Activity view and the changelogs' short SHAs; Dani chose not to ask GitHub
  Support to purge them, since a scan of the whole old history for keys, tokens, credentials and committed `.env`
  files found none, only the details R205 removed. The changelogs' short SHAs and the chart's image tags name commits of
  the old history and stay as labels. The release now running has no tag commit to revert, so rolling it back means
  setting the previous image tags by hand (incidents runbook §3); later releases
  revert as before. An old clone must be cloned again: `git pull --rebase` would replay the old history onto the new.
  Fixed: `scripts/check-migrations-append-only.sh` passed without comparing anything when the base shares no history
  with HEAD, and `scripts/renovate-changeset.sh` went on without the PR's paths; both now fail. Decided (low impact):
  the remarks on the deployment's shape that R205 weighed and kept (chart defaults, the error tracker as an
  integration, the restorable-backup window the sweep needs, one volume shared by replicas) stay. The adversarial
  review found the caches, commit search, the pull requests' refs, the second script and the disabled branch ruleset;
  all handled as above, the ruleset left to Dani.

- **R211. The public site stays up while the database is slow.** In an incident, the database answered so slowly for
  about a quarter of an hour that the API's queries timed out; the cause was outside this app. The web's proxy waited
  for a refresh of its routing table, once that was past its age, on every request, the kubelet's health probe
  included, whose one-second timeout then failed: the kubelet restarted both web pods, each restart dropped the last
  good table, and without one the site answered 503 until the database recovered. Fixed, tests first: the system paths
  (the probe, the relays, the API's word that a site changed), which resolve the same without routing data, are
  answered before the table is awaited; and a table past its age is served at once while a single refresh runs behind
  it, so only the first load and a forced one (R151) wait for the API. Since the probe no longer refreshes the table,
  an idle pod refreshes it on its next request, serving the last one meanwhile; the API's notice of a change still
  forces it. The incidents runbook (§4) covers a database that is slow rather than down. Left as is (low impact,
  decided): the home and election data still wait for a refresh past their age, up to the API's 5-second timeout,
  before serving their last copy; serving them at once too would need care with the election pages read fresh right
  after an edit. The adversarial review found the test that a failed refresh keeps the table passing without checking
  it (it now waits for the refresh), three mutation entries stale against the proxy (updated;
  `scripts/mutations/slow-api.json` breaks this fix), and loose wording; all fixed.

- **R212. Platform admins delete an election permanently.** Dani: "i think admins should be allowed to permanently
  delete stuff"; asked how far, they chose any election, published ones included, from a button in the admin rather
  than a script only the owner runs. `private.purge_election(tenant, election, confirmation)` (migration
  `purge_election`; ADR-0002 §6 and §14 amended) deletes the election with everything in it, children before parents
  as `purge_tenant` does, its audit trail (that of its rows deleted before included, found in the audit by the
  election or the parent its entries name), and the files nothing else names (the sweep removes their bytes,
  ADR-0004). It refuses anyone but a platform admin in person (second factor, no member token), and a confirmation
  other than the election's short name. The immutable tables, which R165 opened to owner sessions only, now have one
  more narrow exemption: the owner's rights, a transaction-local flag naming the election, and an unfinished purge
  record of this very transaction, which the function writes first and no runtime role can write; it marks the record
  finished and clears the flag before returning. The admin shows "Delete permanently" to platform admins on every
  election's page, behind the address name typed (`ConfirmButton` takes a typed confirmation now), through `POST
/t/:tenant/e/:election/purge`. The trade-off, accepted: a published comparison and its corrections can be removed;
  the purge log keeps who, when, which election and how many rows of each kind. Tests first: the database test purges
  a live election with published revisions, reviews, evidence and a report, a draft with a party deleted before, and
  an archived one, and checks that nothing of them is left, their audit trails are gone, the rest is untouched, a
  shared file stays, and that the refusals and the attempts to fake or reuse the exemption hold; a route test, a wrong
  Origin included; `scripts/mutations/purge-election.json`. Specs: editorial workflow E8.4, data model. The
  adversarial review found the exemption usable after the purge returned (the record is now finished first), the audit
  trail of rows deleted before the purge left behind, no test pinning "this transaction", and no archived election or
  wrong Origin in the tests; all fixed. Decided (low impact): a purged election's short name is free again (no
  tombstone, unlike hostnames); a purge isn't refused during a freeze window; share images already in outside caches
  expire on their own; the site's public version isn't bumped (nothing reads it, and the route tells the public site,
  R151); a change request of another election that names this one's report (the foreign keys don't keep them to one
  election) makes the purge refuse with "linked", rather than reach into the other election.

- **R213. A member's token drafts criteria too, in words a person approved.** Dani asked for a test election's
  criteria, drafted from proposals the chapter wrote, to go in through the MCP server rather than typed in the admin.
  Criteria were refused to tokens outright, as the chapter's words (CLAUDE.md); Dani decided a tool may carry them.
  Migration `criteria_drafted_by_tokens` narrows the criteria's `needs_a_person` guard: a token may add, edit and
  order an election's criteria while it is edited directly, never delete one nor link one to a core criterion (nor
  unlink it); a live election's criteria change only through an approved change. The API's token routes add the
  criteria's list, create, edit and order (never delete); the MCP server adds `list_criteria`, `create_criterion`,
  `update_criterion` and `reorder_criteria`, whose descriptions tell the tool to enter only the exact wording a person
  gave and approved, and never to write, complete, reword or translate any. The database can't tell approved wording
  from a tool's, so ADR-0008 and the README say a person rereads criteria before the election goes live. ADR-0008 and
  the README amended. Tests first (the database's token guard, the token routes, the tools), and the mutation lists
  `member-tokens` and `member-token-routes`. The adversarial review found that the API took a token's proposal of a
  change to a live election's criteria or methodology, which the MCP server never offered; the same migration now
  refuses it to tokens. It also found an unproven "equivalent" mutation, untested unlinking, refusal reasons that sent
  a tool round in circles on a live election, a stale comment and wording that tied this plan to a real election; all
  fixed. Decided (low impact): the API keeps answering a direct write to a live election's structure as stale, as for
  people; the tool's reasons now say what that means.

- **R214. A demo site's draft election, filled with invented content** (Dani: use the demo site as a full demo). `node
packages/db/demo/print.ts fill <site> <election>` prints one `DO` block that fills a demo site's untouched draft
  election: the demonstration methodology and reviewer (R130's), an invented programme for each of its 11 parties
  (`print.ts programme <n>` prints its bytes for `put-file`, as R130's), every party's programme published, and all
  110 cells rated, quoted, reviewed and published through the real triggers (four-eyes, verbatim match, evidence),
  spread over the four ratings, as R130's fictional members, removed at the end; then the election goes live. It knows
  the demo's 10 criteria only by their slugs, with invented programme wording on each topic: the criteria's words are
  the site's, entered by a person (R213), never in this repository. It refuses a site not in a user-assigned country,
  an election that isn't an untouched draft, another number of parties, other criteria, and any party not named
  "Partido Ejemplo …" in every language, so invented ratings never go to a real party. Decided with Dani: a
  recognisable knock-off of a real party (a test election's earlier names) gets no invented rating, since it would
  read as a claim about the real one; the demo's parties are "Partido Ejemplo A" to "K". Tests first.

- **R215. The scorecard fits wide screens, and shared links refresh their preview.** Dani: the demo's scorecard (10
  criteria) scrolled sideways on every screen, a 1920-px one included, as the table kept to the text's column. Now it
  widens past that column when it needs to, centred on it, up to the window less 16 px a side, and each rating in it
  stacks its icon above its words (14 px), so a criterion's column takes 104 px: 10 criteria fit from about 1,280 px,
  and the region's sideways scroll stays for narrower windows or more criteria; phones keep their cards. Icon, words
  and colour stay together (the ratings' rule). Dani also asked for a query on shared links so networks don't keep
  showing an old preview: the shared address (the share links, "copy the link" and `og:url`) is the canonical one with
  `?v=` and the link preview's content hash, the one its image's address already carries, so a preview refreshes
  exactly when it changes, two changes in a day included, and not otherwise. `og:url` carries it because Facebook and
  LinkedIn keep a preview by it; `rel=canonical` stays without, for search engines; the page answers the same with or
  without. Tests first for the shared address (unit, and the end-to-end checks that `v` is the image's hash).

## Queued work

Approved by Dani and not built yet, in this order. A new session starts here. The drawings are on a private canvas,
<https://claude.ai/artifact/LjRQ7ifAFvEEi92roaV743> (read it with the Artifact tool), all with fictional data.

1. **The admin forms** ([spec](spec/admin-forms.md)): done, each step its own release (step 1 R183, 2 R189, 3 R190,
   4 R191, 5 R192, 6 R193, 7 R194, 8 R195, 9 R196 and R201, 10 R197).

## Open decisions for Dani

D1–D17 are decided (see [Answered](#answered)); D18–D21 are decided below. Backups, which D2 decided, are the
cluster's, in gitops (see R118's note).

- **D18. Endorsers' legal details are readable by the public role** (found by R169's review; low). `organizations` has a
  table grant to `aiontheballot_web`, and RLS shows every organization linked to an active site, so the public API's
  role can read an endorser's `legal_name`, `tax_id`, `address`, `registry_entry`, `contact_email` and
  `privacy_email`, though the public site shows those only for the operator (the legal notice) and only the display
  name of others. Nothing shows them today; a bug or an injection in a public route could. A column grant can't tell an
  operator's row from an endorser's, so the fix is a policy or a table change. **Recommendation:** keep the table grant
  to the columns every linked organization shows (`id`, `display_name`, `url`, `logo_asset_id`, `is_pauseai_chapter`)
  and give the operator's legal columns to the public through a security-invoker view joined on
  `tenant_organizations.role = 'operator'` (a grant change on a view, no definer): ADR-0002 §7 updated with it. Not
  built: a grant and visibility change beyond this run's tasks.
  **Decided (Dani, 2026-10-14): accepted, not built.** The worst case needs a code mistake in the public API and an
  endorser's record holding a person's details; tax ids and addresses of organizations are mostly public in
  registries. Instead of another view and grant, the organization form says the legal-notice fields are needed only
  for an organization that runs a site, so an endorser's record doesn't hold them (done in R183). Revisit if one
  ever does.

- **D19. A member who never enrolled a second factor and forgot their password** (from R170's review; low). Password
  recovery skips accounts with no second factor (a new password would let whoever reads the mailbox enrol their own
  authenticator), and the owner's `create-account.js` gives a link only to an account with no password, so such a
  member can't get back in. Today the way out is the owner's SQL: delete the account (its memberships stay, shown as
  a deleted account, for a country admin to remove) and invite them again. **Recommendation:** let `create-account.js`
  also give a set-password link to an existing account with a password but no second factor, after the same identity
  check as incidents §5a (it runs as `aiontheballot_auth` with the grants it has: no new grant or function). Not
  built: it changes what the owner's command may do to an existing account.
  **Decided (Dani, 2026-10-14): build as recommended** (built in R186). The self-service "forgot my password"
  stays as it is: an email link for every account with a second factor, none for one without, whose password is
  its only lock (whoever signs in first links their own authenticator), so an email alone never gives a whole
  account.

- **D20. A "not mentioned" that rests only on a replaced document** (from R172's review; low). A replaced source takes
  no new "No lo menciona" check, but the checks it has stay (D14: "existing quotes stay"), so a cell can be updated
  and published again as "not mentioned" on the old version alone after the new one exists, though a check of an old
  programme says nothing about the current one. **Recommendation:** refuse submitting a "not mentioned" draft whose
  only checked documents of the party are replaced (one more condition in the submit and publish triggers, a
  migration), so an editor checks the newer version first; quotes stay as they are. Not built: it narrows what D14
  said stays.
  **Decided (Dani, 2026-10-14): warnings, not a rule** (built in R187). The rule would stop one path, already
  past a second person's review, and miss the larger one: published "not mentioned" ratings nobody reopens after a
  new programme. A warning covers both and leaves the call to the editors. The test for the rest: a database rule
  only for what must never happen however careless everyone is (evidence, a second person, verbatim quotes,
  history); "editors should double-check" is a warning in the admin.

- **D21. Four-eyes counts the first uploader of the same bytes** (from R175's review; low). A site keeps the same bytes
  once (S2.2): a copy uploaded or fetched again, for another source, reuses the file row, whose `created_by` is whoever
  first stored those bytes, and that is who `private.revision_contributors` counts, not who attached them this time. So
  an editor who attaches a document someone else stored earlier isn't counted as its contributor for the cells citing
  the new source. **Recommendation:** stamp who stored a source's copy on the source itself
  (`source_documents.copy_stored_by`, set by the database with the copy, never by the client) and count that in
  `revision_contributors` and the attester rule (R167), instead of the file's uploader: a migration changing a column
  and two functions' bodies (no new function or grant). Not built: it changes the four-eyes rule.
  **Decided (Dani, 2026-10-14): accepted, not built.** No one can publish alone through it: whoever wrote the cell
  is always counted, and so is whoever first stored the bytes, the one who could have altered them. The cost is a
  reviewer refused for a cell they never touched, only when the same file is attached twice; revisit if that
  happens.

## Questions for the chapter

- **Q5. Content.** Please supply the criteria list, methodology text, external reviewers, and the **rule for which
  parties are included**. The rule must be stated in the methodology. Can the party list still change after
  candidacies are proclaimed, for example through appeals?
- **Q6. Legal notice.** Article 10 of the LSSI appears to require registry details and a contact address beyond
  the fields in the brief. Proposal: add `registry_entry` and `contact_email` to `organizations`. Please confirm
  with counsel.
- **Q7. Personal data.** How long should right-of-reply submissions be kept (a per-tenant setting; reports are then
  anonymized), and who is the privacy contact?
  Deleted submissions stay in backups until those expire (the cluster's backup retention, set in gitops), which
  the privacy policy should say.
- **Q8. Electoral law.** Has the association had advice on publishing or updating the table during the campaign,
  and on **reflection day**? There will be a per-election _freeze_ switch; whether and when to use it is the
  chapter's call.
- **Q9. Admissible sources.** Which kinds of source can back a rating? Options: official programmes and documents
  only, or also web pages, debate and interview statements, and social posts. The platform supports all of them
  (PDFs and web pages are matched automatically; the rest need a second person to attest them). Restricting to
  official documents is the most defensible. Separately: which kinds can back "No lo menciona", which may be given
  before a party's programme exists? The default is the party's programme and its website.

## Pushback and clarifications on the brief

My default is in brackets.

- **P1. Canonical hostnames.** "Exactly one canonical hostname per tenant" can't describe tenants that exist only
  on the shared platform domain. [At most one; without one, the canonical URL is `platform-host/{slug}`.]
- **P2. Platform admins.** `platform_admin` isn't scoped to a tenant, so it shouldn't be a tenant membership.
  [A separate `platform_admins` table.]
- **P3. Verbatim matching.** Apply it to **every** quote, not only those the LLM proposes. For sources with no
  extractable text, a second person must attest the quote. [Yes.]
- **P4. Four-eyes.** "Author" means **anyone who edited the revision**, not just its creator. [Yes.]
- **P14. Four-eyes per election.** BRIEF §4 makes a second person mandatory to publish. The pilot may run with one
  or two people, and a mandatory second person would block publishing whenever one is away. [Decided by the owner:
  a per-election setting, on by default. Only a platform admin turns it off, audited; self-review is then recorded
  privately, not shown publicly. It covers publishing, withdrawals, public notes, attestations and corrections.]
- **P15. "No lo menciona" before the programme.** [Decided: allowed, backed by checked records of the party's own
  stored documents (kinds per the methodology, Q9). The cell is flagged for a recheck when the programme appears.]
- **P16. Archived elections.** [Decided: corrections and withdrawals stay possible, under the same review rule and
  with a public note; right-of-reply reports are still handled.]
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
- **P12. Hosting ownership.** §11 says the association owns hosting accounts, but the cluster is a personal one.
  [Acceptable for the pilot, because the cluster is treated as replaceable compute:
  - the association owns the repo, domain, DNS zone, mail sender, error-tracking account and LLM key;
  - deployment is fully declarative;
  - a runbook for moving to another host ships in M5.
    Revisit after the election.]
- **P13. Preview deployments.** There are no per-PR previews (§8 asks for them). A temporary stack spun up in CI
  for end-to-end tests replaces them, and UI demos run locally with the fictional seeds. [Yes. The staging
  instance first planned here was dropped (ADR-0001).]

## Answered

| Topic                                                 | Answer                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who builds it                                         | Side project: Claude implements, Dani reviews                                                                                                                                                                                                                                                                                                                        |
| Hosting                                               | A Kubernetes cluster, deployed by Argo CD from gitops (ADR-0001)                                                                                                                                                                                                                                                                                                     |
| Domain                                                | `iaenlasurnas.es` is already registered                                                                                                                                                                                                                                                                                                                              |
| Licence                                               | AGPL-3.0-or-later for code, CC BY 4.0 for our content. Party quotes are not ours to license. Names and logos are excluded.                                                                                                                                                                                                                                           |
| Tooling                                               | Use the `@slango.configs` packages, and `@slango` packages where useful                                                                                                                                                                                                                                                                                              |
| D3: admin host                                        | One central host, `admin.iaenlasurnas.es`, configurable. Tenant context comes from the path; per-tenant admin hosts can be added later; platform admins stay central.                                                                                                                                                                                                |
| D4: repo                                              | `pauseai-en-espanol/aiontheballot`                                                                                                                                                                                                                                                                                                                                   |
| D5: stack ([ADR-0003](adr/0003-application-stack.md)) | Next.js web and admin, plus a Fastify API and worker that own all data access. Better Auth with mandatory TOTP. dbmate and Kysely, no ORM. Latest stable dependency versions.                                                                                                                                                                                        |
| D1: non-owner DB roles                                | The database's provisioning (gitops) adds login roles that own nothing, forced `NOSUPERUSER … NOBYPASSRLS`, with `CONNECT` on their database. Our migrations (as owner) grant them table privileges.                                                                                                                                                                 |
| Environments                                          | One, production, with no staging (ADR-0001). It tracks `main`, with no `production` branch (R166); during the code freeze, changes come as pull requests the owner merges                                                                                                                                                                                            |
| Names                                                 | `aiontheballot` everywhere: repo, packages (`@aiontheballot/*`), chart, images, registry project, namespace, database and roles. The product name is configuration (`PLATFORM_NAME`).                                                                                                                                                                                |
| D2: backups                                           | Follow the cluster's backup plan (gitops): the database's `pg_dump` and the file volume, copied off the node. The same schedule during the campaign; no app-owned job. Must work before the preview.                                                                                                                                                                 |
| Admin visibility                                      | The admin shows each user only what is theirs: memberships give access per tenant, and a member of another tenant gets nothing, not even published rows (read those on the public site). Platform admins see every tenant except reports. Public-visibility policies apply to `aiontheballot_web` only (ADR-0002).                                                   |
| Public cache key                                      | One version counter per tenant (`public_versions`), the safety net behind revalidation (ADR-0003). Only a `SECURITY DEFINER` trigger on every public-readable table moves it, so no runtime role can set or rewind it (ADR-0002 §6).                                                                                                                                 |
| Invitation acceptance                                 | `accept_invitation()` ships in M2 with Better Auth's tables and reads the verified email from there; M1 ships the `invitations` table, its policies and its revoke/accept transitions.                                                                                                                                                                               |
| O2: Better Auth's role                                | A fourth runtime role, `aiontheballot_auth`, that owns nothing and reaches only Better Auth's tables in the `auth` schema, so the admin role never sees password hashes or TOTP secrets (ADR-0002 §2). Its password and the API's `DATABASE_URL` for it are sealed by `scripts/seal-auth-role-secret.sh`; the role itself comes from the database's values (gitops). |
| Election structure                                    | Editors and country admins write elections (name, date, slug, type, territory), parties and criteria; country admins set election status and the freeze window and write the methodology and its external reviewers; only platform admins change `require_second_reviewer`, either way. Structure is deleted only while its election is a draft.                     |
| Scorecard orientation                                 | Parties down the side, criteria across the top, always (likely more parties than criteria); never switched by count, so screenshots and share images stay comparable. Criteria get a short title for the header (M2 spec, W22). Past about 8 criteria: a fixed party column and sideways scroll. Phones: per-party cards first.                                      |
| D11: archiving in a freeze window                     | The database refuses to archive while a freeze window is set and not over (R109)                                                                                                                                                                                                                                                                                     |
| R94: members' names                                   | The in-place amendment of ADR-0002 §2 stands (R110)                                                                                                                                                                                                                                                                                                                  |
| Creating sites                                        | A platform-admin screen later, demo sites included; the hostname stays a gitops change (R111)                                                                                                                                                                                                                                                                        |
| D6: pre-production checks                             | Migrations rehearsed on a copy of a backup, launch tests on production at a quiet hour (R118)                                                                                                                                                                                                                                                                        |
| Signup list                                           | The site's own double opt-in list: one launch email, an optional future-elections list, the rest deleted (R119)                                                                                                                                                                                                                                                      |
| D7: orphaned bytes                                    | A scheduled sweep with its own role and one narrow function, built with uploads (R117)                                                                                                                                                                                                                                                                               |
| D8: the worker and files                              | Only the job's file, handed over by the API, in a boxed-in sandbox (R116)                                                                                                                                                                                                                                                                                            |
| D9: quote normalisers                                 | The same Unicode rules on both sides, `pg_c_utf8` in the database, U+FEFF dropped (R113)                                                                                                                                                                                                                                                                             |
| D10: invitations without an account                   | One narrow lookup, `private.pending_invitation(token)`, for the admin role only (R114)                                                                                                                                                                                                                                                                               |
| Email                                                 | One platform sender (an SMTP account) now; site mail in the operator's name, replies to its contact email (R115)                                                                                                                                                                                                                                                     |
| D12: jobs to the worker                               | Over HTTP, the API retrying with backoff and handing open jobs over again when their sources are listed, with a shared secret and a report for jobs that wait too long ([ADR-0006](adr/0006-extraction-jobs-over-http.md), R146)                                                                                                                                     |
| D16: report ↔ correction                              | Built as recommended: `assessments.draft_report_id`, its `UPDATE` grant, copied on publish (R157)                                                                                                                                                                                                                                                                    |
| Per-address rate limits at the gateway (R158)         | Approved by Dani: turned on from gitops, the rate-limit service first, then the numbers (incidents §7)                                                                                                                                                                                                                                                               |
| Ingress NetworkPolicy for the public site (R161)      | Approved by Dani: turned on from gitops (`networkPolicy.enabled`, the public gateway's Envoy pods and the API)                                                                                                                                                                                                                                                       |
| D13: copies by URL and archive snapshots              | Built (R175, [ADR-0007](adr/0007-fetching-copies-and-snapshots.md)): a third, smaller box that only fetches (internet egress, no database login, no volume), the API storing its bytes as the requester's; the requester counts as a contributor for four-eyes (D17)                                                                                                 |
| D14: sources replaced after their copy is stored      | Built (R172; asked in R166): a "replaced" mark, set once, that keeps a source out of new quotes and sorts it last; quotes already made stay as they are                                                                                                                                                                                                              |
| D15: previewing a site before it opens                | Through the admin ([ADR-0005](adr/0005-previewing-a-site-through-the-admin.md), accepted; R166): built (R174)                                                                                                                                                                                                                                                        |
| D17: the rest of the row-security review (R165)       | Build the attester rule, the uuid foreign-key meta-test and the web role's grant hygiene (built: R167–R169); reword ADR-0002 §9 (done, R166); keep report metadata in the audit log readable by platform admins, ADR-0002 corrected (R166); keep any editor withdrawing a pending change request                                                                     |
| Password recovery                                     | Built (R170; asked in R166): "I forgot my password" on the sign-in page, and a reset email sent from Members by whoever manages them; the second factor still asked, sessions ended, a notice sent; a lost authenticator stays the owner's command                                                                                                                   |
| A `production` branch (ADR-0001)                      | No (R166): production follows `main`; during the code freeze changes come as pull requests the owner merges                                                                                                                                                                                                                                                          |
| Asking Meta to re-scrape link previews                | Not now (R166): possible later work; meanwhile Facebook's Sharing Debugger, by hand (corrections runbook)                                                                                                                                                                                                                                                            |

## Tracking

| Milestone | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Demo note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0        | Done. Green CI and an automatic release on the self-hosted runner; deployed by Argo CD, with GlitchTip running                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | TS 7 spike passed. Public app serves with no cookies. 34 database tests: catalog meta-tests, normaliser parity, immutability triggers, isolation-matrix harness. Images run as non-root; the CI database job replayed locally against a fresh Postgres. Playwright smoke on production builds, which caught the platform name being fixed at build time. Demo: `iaenlasurnas.es` and `admin.iaenlasurnas.es` serve over TLS through the public gateway, titled from `PLATFORM_NAME`, no cookies; migrations ran as `aiontheballot_owner` before the pods started, and the runtime roles own nothing and cannot bypass RLS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| M1        | Done. Green CI, deployed, and the Spain tenant live on `iaenlasurnas.es`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Schema complete: migrations 1–28 (cells, workflow, evidence rules, reports, revisions, publishing, change control, programme status, purge in this run), with RLS, triggers and grants. Locally: 21,692 database tests, 21,186 of them generated matrix cases; every migration mutation-checked (each rule removed in turn fails a test; the equivalent mutants are named in the commits). A data-rule test shown failing: `publish.spec.ts` 'is refused without a quote' (a cell whose quote was deleted behind the triggers' back can't be published). Fictional seeds (`pnpm db:seed`, refusing any database not on this machine). Routing: `proxy.ts` runs `resolve()` with data the API reads as `aiontheballot_web`; 18 e2e tests on the seeded stack, including status codes, `Location`, a spoofed `X-Forwarded-Host`, the internal prefix (404) and no `Set-Cookie`. CI green after the push. In production, once gitops gave the API its `WEB_DATABASE_URL` and the Spain tenant was created (operator PauseAI España): `iaenlasurnas.es` answers 200 with the tenant's page, the internal prefix 404, a spoofed `X-Forwarded-Host` changes nothing, and there is no `Set-Cookie`. An unknown host gets 404 from the gateway, which has no route for it; the app's own 404 for one is in the e2e tests. Decisions R1–R41 await review. |
| M2        | In progress. Built: the live quote match (R77), refusals (R78), the cell grid (R79), sign-in with TOTP (R84–R93), sites and members (R94–R98), settings and policy texts (R99, R100), elections and their structure, going live, freezing and archiving (R101–R109), invitations (R114), mail (R123), organizations and sites (R112, R129), the cell editor and review workflow (R131), sources and uploads (R132, R139), the extraction worker (R133, on in production: R166), the scheduled sweep (R141, live), party logos (R142), change requests (R143, R144). the extraction handover over HTTP (R146), the right-of-reply queue (R149), history, the corrections log and the audit view (R150), revalidation on publish (R151), quotes picked from their source (R155), the reset of a lost authenticator (R156), rating icons, work queues and the submit checklist (R159), the report↔correction link on cells (R157), attested quotes (C4, R171). Left: nothing of M2's list | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M3        | In progress. Built: the coming-soon page (R42–R56, R82), Plausible (R83), the signup list (R119, R122), the legal notice, privacy policy and operator page (R124), the scorecard and the party, criterion, cell and methodology pages (R125), security headers (R126; the admin's, R145), sitemaps and robots (R127), site settings in the admin (R135), the home's link-preview cards (R52–R58). share images that follow their templates (R147), share cards for every view and the download dialog (R148), the report form (R149), the corrections log page (R150), the whole table as one image (R162), the gateway's per-address limits, in the chart and off until gitops sets them (R158). Left: turning them on (gitops)                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Preview   | Not started. Waits for the chapter's content (Q5–Q9) and the restored backup its gate asks for (D2, see R118's note); the preview through the admin is built (R174) and needs its gitops values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M5        | In progress. Written: the runbooks and the launch checklist (R152), the export of one site (R160). Done: the security audit (R208; Dani found no personal data in the error tracker's events). Waived by Dani: the manual accessibility pass (the launch checklist's item is waived at the go/no-go). Left: the RLS review (a first pass done, R165, its findings built, R167–R169), load test and CDN-proxy contingency (D6), restore drill (D2), uptime monitors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M4        | Gated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
