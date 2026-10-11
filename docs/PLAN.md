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
  - GlitchTip (cluster-wide, VPN-only UI, a database on the shared Postgres), in a second gitops change.

**Demo:** a PR goes green in CI, and the hello-world page loads on `iaenlasurnas.es` over TLS through
`gateway-public`.

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
  only on a preview host on `gateway-private`, reachable over the VPN, so skipping the page needs no cookie or login
  on the public site.

**Demo:**

- A walkthrough on a phone and on a desktop.
- The invariant crawler and the share-image template test pass.
- axe reports zero accessibility violations.

### Preview

**Ships:** real parties and criteria, every cell _pending_, live on `iaenlasurnas.es` with the
`elecciones.pauseai.es` alias redirecting to it.

**Before it:**

- production switches from `main` to the `production` branch (ADR-0001);
- D6 is decided;
- off-node backups work (D2): phases 0 and 1 of the gitops backup plan are done, and a nightly dump of the
  `aiontheballot` database has been restored into a scratch database, with the file volume's copy from after it
  (ADR-0004).

**Gate:** a preview go/no-go. That is also where the cut list is applied if we're behind.

### M5: Hardening and launch

**Ships:**

- **Review:** a second person reviews the RLS policies and the matrix.
- **Security audit:** headers, CSP, dependencies and secrets.
- **Load test** (where: D6): requests per second for HTML and for images, and how much of the uplink they use.
- **Cloudflare-proxy contingency:** tested once (where: D6).
- **Accessibility:** a manual pass.
- **Backups:** a full **restore drill**, the file volume included.
- **Runbooks:** incidents, corrections, reflection-day freeze, moving to other hosting, domain renewal, and restoring
  the database, whose steps include deleting the sweep's ledger (`sweep-ledger.json`, ADR-0004 §5).
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
- **Caching beyond the servers:** the image URLs are immutable, so a CDN in front of `/og/` would be safe. Cloudflare
  is DNS-only today; turning its proxy on is a gitops decision for when traffic needs it.
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
  reviewer's approval is refused rather than silently doing nothing.
- **R25. An approval needs the target unchanged since the proposal;** otherwise it is refused and proposed again, so
  the public "before" value is always true.
- **R26. The values in change requests and structural changes are personal data** (a reviewer's name can be one), so
  the audit log keeps the request but not the values; the public record is `structural_changes`.
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
  differently fails until the version is bumped: a picture never changes under a cached URL.
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
  bytes are gone; the rows, and every rule about them, stay in the database. A `local-path` volume (kept on uninstall,
  never pruned) is mounted by the API at `/data`; the store writes each file under its tenant, bucket and SHA-256,
  before its row. The API reads bytes only for a row RLS shows, from that row's own folder. Until the admin uploads
  (M2), `put-file` puts bytes on the volume from stdin. To do: the gitops backup plan must include the volume, and a
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
- **R66. The volume is `local-path` of type `local`, set explicitly** (`storageClass: local-path`, PVC annotation
  `volumeType: local`): Velero's file-system backup copies `local` volumes but not `hostPath` ones, and the type can't
  change once the volume exists. The class already defaults to `local` in this cluster (`defaultVolumeType`). The
  provisioner creates the folder `root:2000`, mode 0770; uid 1000 writes through `fsGroup: 1000`, which the kubelet
  applies to `local` volumes (Headscale's and Owncast's uid-1000 pods write to theirs this way), now with
  `fsGroupChangePolicy: OnRootMismatch`. The class reclaims with `Retain`, so deleting the claim by hand keeps the
  folder. `local-path` neither enforces nor expands the 5 GiB it asks for.
- **R67. Backups: each volume copy is taken after the database dump it goes with;** the sweep keeps unnamed bytes for
  at least as long as the oldest database dump that could be restored. With the gitops plan's numbers (weekly Velero
  backups kept 90 days, each holding the last 14 nightly dumps) that is 104 days, 111 with a week's margin for
  backups that expire late; I propose 120. Every pod tells Velero to skip its scratch volumes
  (`backup.velero.io/backup-volumes-excludes`), so the API's file volume is all it copies of the namespace. Still to
  do in gitops (the brief has the steps): add the namespace to the backup plan's schedules, after the dump.
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

- **R75. `sweep-files` deletes bytes no row names, once no row has named them for 120 days** (never less than 111: R67's
  104 plus a week for backups that expire late). Since when is the later of the last time a row stopped naming them (a
  deleted file row, or a brand asset given other bytes), which the owner's list takes from the audit log, and when the
  sweep first saw them unnamed (a ledger on the volume, for bytes no row ever named), so bytes named again and dropped
  again wait their full time again. A database restore rewinds the audit log; the list carries the database's identity
  (cluster, timeline, database and audit table OIDs: a logical restore or archive recovery changes it) and the log's
  sequence, and when the identity changes or the sequence goes down every clock starts again and nothing is deleted that
  run, `--delete` or not (a restore by crash recovery, such as a volume snapshot, changes neither, so the restore
  runbook must delete the ledger, which starts every clock again just the same). It runs by hand, like `put-file`: the
  owner pipes the list from Postgres (as `postgres`, row security off, which the list proves), since no runtime role can
  read every tenant's files. It refuses a list cut short, stale or from the future, a list naming nothing while files
  are stored, and one naming files the volume lacks; it deletes more than half the stored files only with
  `--allow-many`; it never deletes a file stored or reused within a day of the list's snapshot (`put` marks reused
  bytes, and the sweep moves a file to `retired/` and checks it there, putting back what a halted sweep left without
  ever replacing a fresh copy, and touching nothing through a link); one runs at a time, and a purge never runs during
  one and also clears what a sweep set aside of its tenant. Without `--delete` it only records and reports. Scheduling
  it needs a new grant: D7.

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
  The two normalisers still differ on rare characters: D9.
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
  CD (v3.5.4 on the cluster) runs `helm dependency build` when `helm template` finds a chart's dependencies missing,
  building them from their `file://` sources in the same checkout, which it cleans at every new revision; CI does the
  same before `helm lint`. This replaces the vendored `.tgz` files of M0, and the check that they matched their sources,
  which put a binary diff in every chart change. Checked before the switch: clean clones with and without them render
  the same 13 objects, byte for byte, with Helm 4.3 and inside Argo's own image. If Argo ever failed to build them, the
  application would show a ComparisonError (`error building helm chart dependencies`) and neither sync nor prune, so the
  running version stays; to go back, revert, run `helm dependency update helm-charts/aiontheballot` and commit the
  tarballs (the reverted ones may be stale). A subchart's new version still needs `helm dependency update` for
  `Chart.lock`. Should the application ever get a `manifest-generate-paths` annotation, it must include the subcharts'
  folders, or their changes would go unseen.

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
  loopback and VPN addresses are not visitors: Next fills in the socket's when nothing set the header, and every such
  view would be one visitor, so those are not sent (preview visitors over the VPN aren't counted). Plausible hashes
  the address and browser with a daily salt, stores neither, and derives countries from the address; the privacy
  policy (M3) must say so. ADR-0003 §7 describes this relay beside the error relay. The tenant page loads the script,
  not the root layout, so a 404 is not a page view; once M3 navigates client-side, the script's own capture would
  count a soft navigation to a missing page, so M3 should turn `autoCapturePageviews` off and send page views from its
  pages. Configuration: `PLAUSIBLE_URL`, Plausible's service inside the cluster, not its public host (the public
  gateway drops `X-Forwarded-For`, so every visitor would be one), and `PLAUSIBLE_SITES`, a JSON object from each
  tenant host to its site's `pa-….js` script; the Plausible site must be named after the host (the platform host would
  put every tenant served by path into one site). A malformed configuration, or events naming another site, count
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
  stays a gitops change. Not scheduled yet.
- **R113. The two quote normalisers follow the same Unicode rules** (D9). One forward migration puts the database's
  quote-matching regexes under `COLLATE "pg_c_utf8"` (Postgres's own Unicode classes, no longer the OS's glibc, which an
  image update could change silently); the live match (R77) uses `\p{Alphabetic}` and `\p{White_Space}` to match; both
  drop U+FEFF (which copying from a PDF or Word brings in); the parity test covers these characters on both sides; and
  a check confirms no stored match would change. To build before the cell editor's UI.
- **R114. Invitations for people without an account use one narrow lookup** (D10). `private.pending_invitation(token)`,
  a `SECURITY DEFINER` function executable by `aiontheballot_admin` only, with an empty `search_path`, returns the email
  and role of a pending, unexpired invitation whose `token_hash` is the token's SHA-256, and nothing otherwise. The API
  creates the account as Better Auth's role with that email verified (following the link proves it) and the person's
  password, signs it in, and `private.accept_invitation(token)` adds the membership at aal1 (W3; nothing until TOTP).
  The token travels in the link's fragment (as R93's), the acceptance endpoint is rate-limited, the token is never
  logged, and one generic message covers every refused link. An ADR-0002 amendment, written when it is built.
- **R115. Email: one platform sender now, each organization's own later** (decided with Dani). Everything goes through
  the platform's Mailu account. Account mail (password resets) comes from the platform; mail on a site's behalf
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
  The M5 load test and the Cloudflare-contingency test run against production before launch. No staging.
- **Backups don't exist yet** (found while deciding D6, read-only kubectl): there is no Velero in the cluster and no
  dump job; the shared Postgres runs only itself and its metrics exporter. ADR-0001's nightly `pg_dump -Fc` and
  off-node copies are still to do, in gitops (Dani's side), before the preview at the latest. Until then no migration
  can be undone by a restore, and R118 has nothing to rehearse on; a manual dump is the stopgap.
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
  ADR-0001 amended). Every `pull_request` job runs on `ubuntu-24.04` (amd64, the cluster's architecture; the
  self-hosted runner is arm64), named rather than `ubuntu-latest` so a new Ubuntu release is a commit; pushes to
  `main` and manual runs stay on the self-hosted runner, which the release needs for Harbor. Each job picks its runner
  with one expression on the event (`runs-on` can't read `env`); the Renovate changeset job only ever runs on pull
  requests, so it names the hosted runner outright and keeps its write token. Every job PRs ran before still runs,
  with the same timeouts until a hosted run shows they're short; a hosted run installs dependencies from scratch.
  Renovate: one group for patch, pin, minor, digest and pin-digest updates (with `rebaseWhen` repeated in it, since
  Renovate's defaults for pins would override the top-level one); the window is `* 0-5 * * 1` in Europe/Madrid, six
  hours, wider than the `schedule:weekly` preset's four, since the hosted app runs an active repository about every
  four hours; `updateNotScheduled: false`, so open PRs change only in the window too (a conflicted one waits for it,
  or for the dependency dashboard); `prHourlyLimit: 0`, since the default of two an hour could hold a major or the
  lock-file PR back a whole week; `rebaseWhen: conflicted`. Security PRs ignore the window, which a config can't
  change, though for npm packages pnpm's own 3-day minimum (`pnpm-workspace.yaml`) may still refuse a fix younger
  than that in the lockfile. Lock-file maintenance keeps its own weekly PR (`config:best-practices`), since Renovate
  can't group it with other updates. From the adversarial review. To verify on the next Renovate PR's run.
- **R121. The public site's spec, written where the plan left it open** ([spec/public-site.md](spec/public-site.md)).
  A site is _coming soon_ until `OPEN_SITES` (the web app's environment, gitops) lists its slug, the Preview
  go/no-go's switch, with no schema change; coming soon, it serves only its home and the always-on pages. The preview
  host, `PREVIEW_HOST`, serves `/{slug}/…` for every tenant as if open, never redirected to a canonical host and never
  indexed (`X-Robots-Tag` and the robots meta tag); its route belongs on `gateway-private` (a gitops step). The proxy
  tells pages the mode and their root in request headers it always sets itself, over whatever a client sent. Only
  live and archived elections are public, so going live shows an election's parties and criteria on the preview host
  first, while the public addresses stay coming soon. Paths use the words of the tenant's default locale in every
  locale (`/aviso-legal`, `/en/aviso-legal`), mapped in `resolve()` onto the app's English routes; an English word on
  a Spanish site is a 404, so a page has one address. Every language's tenant-level words are reserved election slugs
  (migration `reserved_site_paths`; `RESERVED_ELECTION_SLUGS` follows `SITE_WORDS`).
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
  confirmation goes out after the signup's transaction commits; if Mailu refuses it, the signup is deleted again with
  its own token, so the person can try again at once. A shutting-down API waits up to 10 seconds for emails on their
  way. Failures are logged and reported with the SMTP code and command only, never the message or the recipients,
  which quote the address; a signup that couldn't be undone is reported apart. `packages/i18n` now takes its
  translator from `use-intl/core`, the same `createTranslator` next-intl re-exported, so the API uses it without
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

## Open decisions for Dani

None open: D1–D11 are decided (see [Answered](#answered)). Backups, which D2 decided, aren't running yet (see
R118's note).

## Questions for the chapter

- **Q5. Content.** Please supply the criteria list, methodology text, external reviewers, and the **rule for which
  parties are included**. The rule must be stated in the methodology. Can the party list still change after
  candidacies are proclaimed, for example through appeals?
- **Q6. Legal notice.** Article 10 of the LSSI appears to require registry details and a contact address beyond
  the fields in the brief. Proposal: add `registry_entry` and `contact_email` to `organizations`. Please confirm
  with counsel.
- **Q7. Personal data.** How long should right-of-reply submissions be kept (a per-tenant setting; reports are then
  anonymized), and who is the privacy contact?
  Deleted submissions stay in backups until those expire (up to 90 days under the cluster's backup policy), which
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

| Topic                                                 | Answer                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who builds it                                         | Side project: Claude implements, Dani reviews                                                                                                                                                                                                                                                                                                                                      |
| Hosting                                               | `danilupion-com`, following the gifcept pattern; Cloudflare for DNS only                                                                                                                                                                                                                                                                                                           |
| Domain                                                | `iaenlasurnas.es` is already registered                                                                                                                                                                                                                                                                                                                                            |
| Licence                                               | AGPL-3.0-or-later for code, CC BY 4.0 for our content. Party quotes are not ours to license. Names and logos are excluded.                                                                                                                                                                                                                                                         |
| Tooling                                               | Use the `@slango.configs` packages, and `@slango` packages where useful                                                                                                                                                                                                                                                                                                            |
| D3: admin host                                        | One central host, `admin.iaenlasurnas.es`, configurable. Tenant context comes from the path; per-tenant admin hosts can be added later; platform admins stay central.                                                                                                                                                                                                              |
| D4: repo                                              | `pauseai-en-espanol/aiontheballot`                                                                                                                                                                                                                                                                                                                                                 |
| D5: stack ([ADR-0003](adr/0003-application-stack.md)) | Next.js web and admin, plus a Fastify API and worker that own all data access. Better Auth with mandatory TOTP. dbmate and Kysely, no ORM. Latest stable dependency versions.                                                                                                                                                                                                      |
| D1: non-owner DB roles                                | halyard `postgresql` chart 1.1.0 adds `databases[].extraRoles`: login roles that own nothing, forced `NOSUPERUSER … NOBYPASSRLS`, with `CONNECT` on their database. Our migrations (as owner) grant them table privileges.                                                                                                                                                         |
| Environments                                          | One, production, with no staging (ADR-0001). It tracks `main` until the preview, then a `production` branch the owner fast-forwards.                                                                                                                                                                                                                                               |
| Names                                                 | `aiontheballot` everywhere: repo, packages (`@aiontheballot/*`), chart, images, Harbor project, namespace, database and roles. The product name is configuration (`PLATFORM_NAME`).                                                                                                                                                                                                |
| D2: backups                                           | Follow the gitops backup plan (Velero + MinIO + DB dumps): the shared Postgres's nightly `pg_dump`, copied off the node by Velero. Nightly also during the campaign; no app-owned job. Must work before the preview.                                                                                                                                                               |
| Admin visibility                                      | The admin shows each user only what is theirs: memberships give access per tenant, and a member of another tenant gets nothing, not even published rows (read those on the public site). Platform admins see every tenant except reports. Public-visibility policies apply to `aiontheballot_web` only (ADR-0002).                                                                 |
| Public cache key                                      | One version counter per tenant (`public_versions`), the safety net behind revalidation (ADR-0003). Only a `SECURITY DEFINER` trigger on every public-readable table moves it, so no runtime role can set or rewind it (ADR-0002 §6).                                                                                                                                               |
| Invitation acceptance                                 | `accept_invitation()` ships in M2 with Better Auth's tables and reads the verified email from there; M1 ships the `invitations` table, its policies and its revoke/accept transitions.                                                                                                                                                                                             |
| O2: Better Auth's role                                | A fourth runtime role, `aiontheballot_auth`, that owns nothing and reaches only Better Auth's tables in the `auth` schema, so the admin role never sees password hashes or TOTP secrets (ADR-0002 §2). Its password and the API's `DATABASE_URL` for it are sealed by `scripts/seal-auth-role-secret.sh`; the role itself comes from the postgresql values' `extraRoles` (gitops). |
| Election structure                                    | Editors and country admins write elections (name, date, slug, type, territory), parties and criteria; country admins set election status and the freeze window and write the methodology and its external reviewers; only platform admins change `require_second_reviewer`, either way. Structure is deleted only while its election is a draft.                                   |
| Scorecard orientation                                 | Parties down the side, criteria across the top, always (likely more parties than criteria); never switched by count, so screenshots and share images stay comparable. Criteria get a short title for the header (M2 spec, W22). Past about 8 criteria: a fixed party column and sideways scroll. Phones: per-party cards first.                                                    |
| D11: archiving in a freeze window                     | The database refuses to archive while a freeze window is set and not over (R109)                                                                                                                                                                                                                                                                                                   |
| R94: members' names                                   | The in-place amendment of ADR-0002 §2 stands (R110)                                                                                                                                                                                                                                                                                                                                |
| Creating sites                                        | A platform-admin screen later, demo sites included; the hostname stays a gitops change (R111)                                                                                                                                                                                                                                                                                      |
| D6: pre-production checks                             | Migrations rehearsed on a copy of a backup, launch tests on production at a quiet hour (R118)                                                                                                                                                                                                                                                                                      |
| Signup list                                           | The site's own double opt-in list: one launch email, an optional future-elections list, the rest deleted (R119)                                                                                                                                                                                                                                                                    |
| D7: orphaned bytes                                    | A scheduled sweep with its own role and one narrow function, built with uploads (R117)                                                                                                                                                                                                                                                                                             |
| D8: the worker and files                              | Only the job's file, handed over by the API, in a boxed-in sandbox (R116)                                                                                                                                                                                                                                                                                                          |
| D9: quote normalisers                                 | The same Unicode rules on both sides, `pg_c_utf8` in the database, U+FEFF dropped (R113)                                                                                                                                                                                                                                                                                           |
| D10: invitations without an account                   | One narrow lookup, `private.pending_invitation(token)`, for the admin role only (R114)                                                                                                                                                                                                                                                                                             |
| Email                                                 | One platform sender through Mailu now; site mail in the operator's name, replies to its contact email (R115)                                                                                                                                                                                                                                                                       |

## Tracking

| Milestone | Status                                                                                                                                                                                                                                                                                                                                                                               | Demo note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0        | Done. Green CI and an automatic release on the self-hosted runner; deployed by Argo CD on danilupion-com, with GlitchTip running cluster-wide (VPN-only UI)                                                                                                                                                                                                                          | TS 7 spike passed. Public app serves with no cookies. 34 database tests: catalog meta-tests, normaliser parity, immutability triggers, isolation-matrix harness. Images run as non-root; the CI database job replayed locally against a fresh Postgres. Playwright smoke on production builds, which caught the platform name being fixed at build time. Demo: `iaenlasurnas.es` and `admin.iaenlasurnas.es` serve over TLS through `gateway-public`, titled from `PLATFORM_NAME`, no cookies; migrations ran as `aiontheballot_owner` before the pods started, and the runtime roles own nothing and cannot bypass RLS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M1        | Done. Green CI, deployed, and the Spain tenant live on `iaenlasurnas.es`                                                                                                                                                                                                                                                                                                             | Schema complete: migrations 1–28 (cells, workflow, evidence rules, reports, revisions, publishing, change control, programme status, purge in this run), with RLS, triggers and grants. Locally: 21,692 database tests, 21,186 of them generated matrix cases; every migration mutation-checked (each rule removed in turn fails a test; the equivalent mutants are named in the commits). A data-rule test shown failing: `publish.spec.ts` 'is refused without a quote' (a cell whose quote was deleted behind the triggers' back can't be published). Fictional seeds (`pnpm db:seed`, refusing any database not on this machine). Routing: `proxy.ts` runs `resolve()` with data the API reads as `aiontheballot_web`; 18 e2e tests on the seeded stack, including status codes, `Location`, a spoofed `X-Forwarded-Host`, the internal prefix (404) and no `Set-Cookie`. CI green after the push. In production, once gitops gave the API its `WEB_DATABASE_URL` and the Spain tenant was created (operator PauseAI España): `iaenlasurnas.es` answers 200 with the tenant's page, the internal prefix 404, a spoofed `X-Forwarded-Host` changes nothing, and there is no `Set-Cookie`. An unknown host gets 404 from the gateway, which has no route for it; the app's own 404 for one is in the e2e tests. Decisions R1–R41 await review. |
| M2        | In progress: the live quote match (R77), database refusals (R78), the cell grid (R79), sign-in with TOTP in the API and the admin (R84–R92), the first account (R93), choosing a site and managing its members (R94–R98), tenant settings and policy texts (R99, R100), elections and their structure, going live, freezing and archiving them (R101–R107). Invitations wait for D10 | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M3        | Not started                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Preview   | Not started                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M5        | Not started                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M4        | Gated                                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
