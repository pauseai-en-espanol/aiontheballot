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
| [Data model](spec/data-model.md)                                                                     | M1           | Approved                                                |
| [Editorial workflow](spec/editorial-workflow.md) (user stories and acceptance criteria per role)     | M2           | Drafted; awaits review                                  |
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
  Better Auth's tables, since it checks the invited email against the user's verified email.
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
- **R50. "Avísame cuando se publique" links to the operator's own newsletter** (migration
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

- **R75. `sweep-files` deletes bytes no row names, once no row has named them for 120 days** (never less than 111:
  R67's 104 plus a week for backups that expire late). Since when is the later of the last time a row stopped naming
  them (a deleted file row, or a brand asset given other bytes), which the owner's list takes from the audit log, and
  when the sweep first saw them unnamed (a ledger on the volume, for bytes no row ever named), so bytes named again
  and dropped again wait their full time again. A database restore rewinds the audit log; the list carries its
  sequence, and when that goes down every clock starts again and nothing is deleted that run. It runs by hand, like
  `put-file`: the owner pipes the list from Postgres (as `postgres`, row security off, which the list proves), since
  no runtime role can read every tenant's files. It refuses a list cut short, stale or from the future, a list naming
  nothing while files are stored, and one naming files the volume lacks; it deletes more than half the stored files
  only with `--allow-many`; it never deletes a file stored or reused within a day of the list's snapshot (`put` marks
  reused bytes, and the sweep moves a file to `retired/` and checks it there, putting back what a halted sweep left);
  one runs at a time. Without `--delete` it only records and reports. Scheduling it needs a new grant: D7.

**Reserved election slugs:**

- **R76. An election's slug can never be `brand`, `og` or `healthz`** (migration `reserved_election_slugs`, a check
  on `elections`), since an election's pages live at `/{slug}` and the public site serves those paths itself:
  `healthz` is added to Dani's two because the health probe answers it on every host before routing, so an election
  with that slug would be unreachable (`og`, two letters, is also refused as locale-shaped; it is listed anyway, so the
  list doesn't lean on that rule). The list is `RESERVED_ELECTION_SLUGS` in `packages/domain`; a web test fails
  when a route under the tenant's root is neither in it nor has a dot (`favicon.ico`, which no slug can take). The
  public site's own pages (methodology, legal notice and the like) get paths in its spec (M3); each needs adding then,
  or a prefix of its own. Tenant slugs, on the platform host, aren't covered.

**M2 (editorial workflow), slices taken while Dani was away:**

- **R77. The cell editor's live match (W13) is in `packages/domain`** (`matchQuote`), mirroring the database's trigger
  step for step (each page normalised on its own, joined with one space, the first occurrence, 15 characters counted
  as the database counts them), and a database test runs the same quotes through both. When a quote doesn't match,
  "the longest matching part" (C2.6) is the longest start or end of the quote that appears, found by binary search (a
  few dozen searches of the text), rather than the longest common substring of quote and source, which would cost
  the quote's length times the programme's on every keystroke. It shows the editor where the difference begins. It
  also applies the column's limits (15 to 1,000 characters as stored), so it never calls a quote the database refuses
  a match. That part is given normalised; the editor will need it mapped back onto the quote as typed. The API route
  that serves it, which should keep each source's normalised pages rather than redo them per keystroke, waits for
  sign-in (editorial workflow spec §18, O2). The two normalisers still differ on rare characters: D9.
- **R78. Database refusals become HTTP answers by SQLSTATE alone** (editorial workflow §2.3): 42501 → 403, 23001
  → 409 ("reload"), 23514 → 422, 23505 → 409, invalid values → 400, each with a message key in `packages/i18n` (English
  and Spanish), plus the constraint's name for unique and check violations so the admin can point at the field.
  Anything else is a 500 to report. The database's own message and detail are never passed on: they can quote what
  was written. Mapping each trigger's message to its own key, as §2.3 asks, comes with the routes that raise them.
- **R79. The cell grid (C1.1) is an API data function, `cellGrid`, read in the actor's transaction** (its type asks
  for one), so RLS decides who sees which election, and the tenant in the path picks it (two tenants may share an
  election slug). A cell is _published with a newer draft_ when it is a draft and has a revision; _withdrawn_ shows
  as published without a rating, never as pending; _rejected_, with the reviewer's note, while its latest workflow
  event is a rejection (comments don't count; resubmitting records a newer event); flagged while it has a recheck
  reason. Its route waits for sign-in (editorial workflow spec §18, O2).

## Open decisions for Dani

D1–D5 are decided (see [Answered](#answered)). D7 and D8 came with the file volume (ADR-0004), D9 with the live
quote match (R77).

| #   | Decision                                                      | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D6  | Where pre-production checks run, now that there is no staging | Rehearse each migration against the latest backup restored into a throwaway database (it doubles as the restore test). Run the M5 load test and the Cloudflare-contingency test against production before launch, at a quiet hour. Decide before the preview.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D7  | Run the orphan-bytes sweep on a schedule                      | It runs by hand now, the owner piping the list of files (R75). A schedule needs something that can read every tenant's file keys and delete bytes on the volume: recommended, a CronJob from the API's image with its own login role, allowed only to execute a `SECURITY DEFINER` function that returns the keys and deletion times (an ADR-0002 change), mounting the volume as the API does. Not the worker, which parses hostile documents (D8). Until then, by hand a few times a year is enough.                                                                                                                                                                                                                                                                        |
| D8  | Whether the worker mounts the file volume                     | It parses hostile documents (A8) and its RLS limits it to one job's file. Recommended: the worker reads only the job's file, handed over by the API or through a read-only mount checked against the job's row; never the whole volume read-write. Decide before the extraction worker (M2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D9  | Make the two quote normalisers agree on rare characters       | The live match (R77) and the database differ where Spanish text rarely goes: U+FEFF is a blank to JavaScript and not to Postgres, and combining marks such as U+0903 are letters to Postgres's `[[:alpha:]]` (which follows the database's `en_US.utf8` ctype, so the OS's glibc) and not to `\p{L}`. Where they differ, the database decides on save and the editor sees the disagreement C2.7 reports. Recommended: one forward migration putting the database's regexes under `COLLATE "pg_c_utf8"` (Unicode's classes, not the OS's), JavaScript using `\p{Alphabetic}` and `\p{White_Space}` to match, both dropping U+FEFF, and these characters in the parity test; stored matches are not recomputed, so check none would change. Decide before the cell editor's UI. |

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

| Topic                                                 | Answer                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who builds it                                         | Side project: Claude implements, Dani reviews                                                                                                                                                                                                                                                                                                    |
| Hosting                                               | `danilupion-com`, following the gifcept pattern; Cloudflare for DNS only                                                                                                                                                                                                                                                                         |
| Domain                                                | `iaenlasurnas.es` is already registered                                                                                                                                                                                                                                                                                                          |
| Licence                                               | AGPL-3.0-or-later for code, CC BY 4.0 for our content. Party quotes are not ours to license. Names and logos are excluded.                                                                                                                                                                                                                       |
| Tooling                                               | Use the `@slango.configs` packages, and `@slango` packages where useful                                                                                                                                                                                                                                                                          |
| D3: admin host                                        | One central host, `admin.iaenlasurnas.es`, configurable. Tenant context comes from the path; per-tenant admin hosts can be added later; platform admins stay central.                                                                                                                                                                            |
| D4: repo                                              | `pauseai-en-espanol/aiontheballot`                                                                                                                                                                                                                                                                                                               |
| D5: stack ([ADR-0003](adr/0003-application-stack.md)) | Next.js web and admin, plus a Fastify API and worker that own all data access. Better Auth with mandatory TOTP. dbmate and Kysely, no ORM. Latest stable dependency versions.                                                                                                                                                                    |
| D1: non-owner DB roles                                | halyard `postgresql` chart 1.1.0 adds `databases[].extraRoles`: login roles that own nothing, forced `NOSUPERUSER … NOBYPASSRLS`, with `CONNECT` on their database. Our migrations (as owner) grant them table privileges.                                                                                                                       |
| Environments                                          | One, production, with no staging (ADR-0001). It tracks `main` until the preview, then a `production` branch the owner fast-forwards.                                                                                                                                                                                                             |
| Names                                                 | `aiontheballot` everywhere: repo, packages (`@aiontheballot/*`), chart, images, Harbor project, namespace, database and roles. The product name is configuration (`PLATFORM_NAME`).                                                                                                                                                              |
| D2: backups                                           | Follow the gitops backup plan (Velero + MinIO + DB dumps): the shared Postgres's nightly `pg_dump`, copied off the node by Velero. Nightly also during the campaign; no app-owned job. Must work before the preview.                                                                                                                             |
| Admin visibility                                      | The admin shows each user only what is theirs: memberships give access per tenant, and a member of another tenant gets nothing, not even published rows (read those on the public site). Platform admins see every tenant except reports. Public-visibility policies apply to `aiontheballot_web` only (ADR-0002).                               |
| Public cache key                                      | One version counter per tenant (`public_versions`), the safety net behind revalidation (ADR-0003). Only a `SECURITY DEFINER` trigger on every public-readable table moves it, so no runtime role can set or rewind it (ADR-0002 §6).                                                                                                             |
| Invitation acceptance                                 | `accept_invitation()` ships in M2 with Better Auth's tables and reads the verified email from there; M1 ships the `invitations` table, its policies and its revoke/accept transitions.                                                                                                                                                           |
| Election structure                                    | Editors and country admins write elections (name, date, slug, type, territory), parties and criteria; country admins set election status and the freeze window and write the methodology and its external reviewers; only platform admins change `require_second_reviewer`, either way. Structure is deleted only while its election is a draft. |
| Scorecard orientation                                 | Parties down the side, criteria across the top, always (likely more parties than criteria); never switched by count, so screenshots and share images stay comparable. Criteria get a short title for the header (M2 spec, W22). Past about 8 criteria: a fixed party column and sideways scroll. Phones: per-party cards first.                  |

## Tracking

| Milestone | Status                                                                                                                                                                 | Demo note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0        | Done. Green CI and an automatic release on the self-hosted runner; deployed by Argo CD on danilupion-com, with GlitchTip running cluster-wide (VPN-only UI)            | TS 7 spike passed. Public app serves with no cookies. 34 database tests: catalog meta-tests, normaliser parity, immutability triggers, isolation-matrix harness. Images run as non-root; the CI database job replayed locally against a fresh Postgres. Playwright smoke on production builds, which caught the platform name being fixed at build time. Demo: `iaenlasurnas.es` and `admin.iaenlasurnas.es` serve over TLS through `gateway-public`, titled from `PLATFORM_NAME`, no cookies; migrations ran as `aiontheballot_owner` before the pods started, and the runtime roles own nothing and cannot bypass RLS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M1        | Done. Green CI, deployed, and the Spain tenant live on `iaenlasurnas.es`                                                                                               | Schema complete: migrations 1–28 (cells, workflow, evidence rules, reports, revisions, publishing, change control, programme status, purge in this run), with RLS, triggers and grants. Locally: 21,692 database tests, 21,186 of them generated matrix cases; every migration mutation-checked (each rule removed in turn fails a test; the equivalent mutants are named in the commits). A data-rule test shown failing: `publish.spec.ts` 'is refused without a quote' (a cell whose quote was deleted behind the triggers' back can't be published). Fictional seeds (`pnpm db:seed`, refusing any database not on this machine). Routing: `proxy.ts` runs `resolve()` with data the API reads as `aiontheballot_web`; 18 e2e tests on the seeded stack, including status codes, `Location`, a spoofed `X-Forwarded-Host`, the internal prefix (404) and no `Set-Cookie`. CI green after the push. In production, once gitops gave the API its `WEB_DATABASE_URL` and the Spain tenant was created (operator PauseAI España): `iaenlasurnas.es` answers 200 with the tenant's page, the internal prefix 404, a spoofed `X-Forwarded-Host` changes nothing, and there is no `Set-Cookie`. An unknown host gets 404 from the gateway, which has no route for it; the app's own 404 for one is in the e2e tests. Decisions R1–R41 await review. |
| M2        | In progress: slices that need no sign-in (the live quote match, R77; database refusals, R78; the cell grid, R79). Sign-in waits for the spec's O2, the spec for review | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M3        | Not started                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Preview   | Not started                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M5        | Not started                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M4        | Gated                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
