# Product brief — working name "AI on the Ballot" (codename: `aiontheballot`)

> Save this file as `docs/BRIEF.md` in the repo. It is the source of truth for scope and constraints.
> The platform name is a **working name** and may change: keep it in config, never hardcode it.

## 1. What we're building

A multi-tenant platform on which advocacy organisations publish, per country and per election, a **transparent, sourced comparison of political parties' positions on frontier-AI risk**. Think of the Greenpeace election tables: parties as columns, criteria as rows, one icon-and-text rating per cell, and every cell backed by evidence.

**Pilot tenant:** Spain, displayed as **"IA en las urnas"**. It is run by **PauseAI España** (legal entity: *Asociación Pausemos La IA*) for the Spanish general election, expected on **29 Nov 2026** (verify; dates shift). Other countries will follow as additional tenants run by other organisations.

### Audiences
1. **Voters** who care about AI risk: where does each party stand?
2. **Parties and journalists:** public pressure. Silence is itself a position, so "not mentioned" is a first-class rating.
3. **Social media:** shareable images are the main distribution channel. The canonical URL printed on every image is effectively our billboard.

### Credibility is the product
Parties will try to discredit the table. Every design decision should make the table hard to attack: verbatim evidence, visible methodology, named operator, review history, a public corrections log, and a right of reply.

---

## 2. Tenancy

### Tenants and hostnames
- **A tenant is one country instance run by one operator organisation.** Fields: `slug` (`es`, `uk`), `default_locale`, localised `display_name`, `theme`.
- **Hostnames live in a `tenant_hostnames` table.**
  - The hostname is the primary key, so it is globally unique: no tenant can claim another tenant's host.
  - Exactly one hostname per tenant is canonical (partial unique index).
  - A hostname must be verified before it serves anything (DNS TXT challenge, `verified_at`).
- **Request routing:**
  - Resolve the `Host` header against verified hostnames only.
  - Unknown host → **404**. Never fall back to a default tenant.
  - Non-canonical host → **301** to the canonical host, same path.
  - A shared platform domain serves `/{tenant-slug}/…` for tenants without their own domain. If a tenant has a canonical custom domain, those paths 301 to it.
- **Canonical host everywhere:** `rel=canonical`, OG and share URLs, sitemaps, and the URL printed on images all come from the tenant's canonical hostname.
- **Elections are paths under a tenant:** `/{election-slug}`, e.g. `/generales-2026`, `/europeas-2029`. The domain outlives each election.
- **Hostnames are never deleted once used publicly.** A retired hostname keeps redirecting forever, because shared images carry it.
- **TLS for custom hostnames** is issued only for verified hostnames: on-demand TLS with an allow-check against the table, or a host's managed custom-hostname feature.
- **Spain pilot hostnames:**
  - Canonical: a Spanish product domain (candidate: `iaenlasurnas.es`; final name TBD).
  - `elecciones.pauseai.es` as a verified alias that redirects to it.

### Authorization
- **Authorization is never derived from the `Host` header.** The host only selects which public content to render.
- **Permissions come from `memberships(user_id, tenant_id, role)`.** Roles:
  - `platform_admin` (very few people)
  - `country_admin`
  - `editor`
  - `reviewer`
- **Enforced with Postgres row-level security on `tenant_id`** for every tenant-owned table, including storage buckets. Rules:
  - Published rows are world-readable.
  - Drafts, review queues, source uploads and audit data are readable and writable only by that tenant's members.
- **The admin UI lives on one central admin host.** Do not run sessions or cookies on every custom domain.
- **The service-role key is never shipped to a client.** Server code that bypasses RLS must be minimal, isolated and reviewed.

---

## 3. Organisations, attribution and platform invariants

### Organisations
- **`organizations` table:** `display_name` (localised), `legal_name`, `tax_id`, `address`, `url`, `logo_asset_id`, `is_pauseai_chapter` (only `platform_admin` can set it).
- **`tenant_organizations(tenant_id, organization_id, role ∈ {operator, endorser})`:**
  - **Exactly one operator per tenant.** The operator is the legal owner, the data controller, and the entity named in the legal notice.
  - Endorsers are optional and displayed alongside the operator.

### Methodology (per election)
- **`kind ∈ {demands, descriptive}`.**
  - **`demands`:** parties are scored against an organisation's demands. `demands_owner_id` is required (DB check constraint). The legend reads e.g. "¿Cumple las demandas de {owner}?". Scale: *Cumple / Cumple parcialmente / No cumple / No lo menciona*.
  - **`descriptive`:** a stoplight scale. Green means at least one concrete proposal, yellow means mentions AI without proposals, red means no position, plus *No lo menciona*.
- **Localised methodology body.**
- **Named external reviewers** of the methodology: name and affiliation.

### Platform invariants
These are enforced in shared layout and templates, not in tenant config, and cannot be disabled by any tenant:
1. **Every public page renders "An initiative of {operator}"** (localised) with a link to the operator's site.
2. **Every scorecard links to its methodology.**
3. **Legal notice and privacy policy are generated per tenant** from the operator's legal fields. Spain requires an *aviso legal*.
4. **Share images use a fixed template:** product name and canonical URL large, operator mark small, short methodology link. Tenants supply assets only.
5. **Restricted brand assets** (e.g. the PauseAI logo) are selectable only by tenants whose operator `is_pauseai_chapter = true` **and** has been granted the asset by a `platform_admin`.
6. **Only `platform_admin` can change a tenant's operator or methodology kind.** Every such change is written to the audit log.

These invariants must have automated tests (see §8).

---

## 4. Content model

`tenant → election → party, criterion → assessment (party × criterion) → evidence`

### Election
- Type, date, status (`draft` / `live` / `archived`), and its methodology.

### Party
- Name, short name, logo, colour, display order, website.
- **Programme status:** `pending` / `published` / `checked_at`. Programmes are often published late, so "programa aún no publicado (comprobado el …)" is a real public state.

### Criterion
- Localised title and description, display order.
- Optional mapping to a **global core criterion**. A shared core set enables future cross-country views such as the European elections.

### Assessment
- `rating` (enum per methodology kind), localised short summary.
- `status`: `draft` → `in_review` → `published`.
- Author, reviewer, timestamps.

### Evidence
Evidence items per assessment:
- **Verbatim quote**
- Source URL and document title
- **Page or section**
- `retrieved_at`
- Archived snapshot URL
- Hash of our stored copy (party sites change mid-campaign)

### Data rules (enforce in DB, not only in UI)
- **Evidence requirement:** a published rating other than "not mentioned" requires at least one evidence item with a verbatim quote. "Not mentioned" requires a record of which documents were checked, and when.
- **Four-eyes rule:** reviewer ≠ author to publish.
- **Full history:** every change to a published assessment is versioned.
- **Public corrections log:** a changelog per election, plus "last updated" on every cell.
- **Right of reply:** a public "report an error / party response" form feeds an editorial queue, with rate limiting and anti-spam. Accepted corrections appear in the corrections log.

---

## 5. LLM-assisted extraction

**Rule: the LLM drafts, humans decide, and nothing reaches the public site without a human.**

### Pipeline
1. Ingest the programme (PDF or URL) and extract text with page mapping.
2. Store the original file, its hash, and an archived snapshot URL.
3. Per criterion, the LLM proposes:
   - Candidate passages with page numbers
   - A suggested rating
   - A short rationale
4. **Verbatim check:** every proposed quote is string-matched (whitespace and hyphenation tolerant) against the extracted text. Unmatched quotes are rejected automatically and never shown as evidence.
5. The editor accepts, edits or rejects. The reviewer approves. The normal four-eyes publish rule applies.
6. Store provenance: model, prompt version, and run date for each suggestion.

### Implementation notes
- Make the provider pluggable, with the Anthropic API as default.
- Track cost per run. This is a volunteer organisation with a small budget.
- **Why this is strict:** published research found AI election tools misrepresent party positions in a large share of cases. Our credibility depends on never doing that.

---

## 6. Public site

### Pages
- **Scorecard:**
  - Desktop: parties × criteria table.
  - **Mobile-first:** a 5 × 15 table does not fit on a phone. Design a per-party or per-criterion card view as a first-class layout, not a degraded one.
- Per-party page and per-criterion page.
- Cell detail: rating, summary, quotes, sources, history.
- Methodology, about the operator, corrections log, legal notice, privacy, contact / report an error.

### Share images
- Generated server-side for:
  - The election overview
  - Each party
  - Each criterion
  - Each cell
- Sizes: link preview (1200×630), square (1080×1080), portrait (1080×1350) and story (1080×1920).
- Downloadable from the page. Uses the fixed template (§3, invariant 4).

### Accessibility, language, performance, privacy, SEO
- **Accessibility:** WCAG 2.2 AA. **Ratings are never conveyed by colour alone** (icon + text + colour).
- **i18n:**
  - All UI strings localised.
  - Spanish first. Design for Catalan, Basque and Galician later.
  - `hreflang` across locales.
- **Performance:**
  - Static or incrementally regenerated pages.
  - Fast on poor mobile connections.
  - Must survive sudden traffic spikes from viral shares.
- **Privacy:**
  - No tracking cookies by default.
  - Cookieless, privacy-friendly analytics, so no cookie banner is needed.
  - Any personal data (forms) is stored per tenant, with the operator as controller.
- **SEO:** per-tenant sitemaps, canonical URLs, structured data where it helps.

---

## 7. Out of scope for the pilot (the schema must not block these)

- **Contact-your-candidate tool:** email lists per tenant, operator as controller, explicit consent, never shared across tenants.
- **Party questionnaire:** parties submit their positions directly.
- **Cross-country views** via global core criteria (European elections).
- **Tenant self-onboarding** with DNS verification UI.
- **Data processing agreements** between the platform operator and tenant operators (process, not code, but keep data export and deletion per tenant possible).

---

## 8. Quality bar

### Language and tests
- **TypeScript strict.**
- **Tests at three levels:** unit, integration, end-to-end (Playwright).

### Security tests (mandatory)
- **Tenant-isolation matrix:** for every role × own tenant / other tenant × each table and bucket × read / write / delete, assert the expected allow or deny at the database level. RLS gets tested directly, not just through the UI.
- **Hostname routing:**
  - Unknown host → 404
  - Alias → 301 to canonical
  - Unverified host serves nothing
  - Duplicate hostname rejected
- **Platform invariants:** every public route renders the operator line and the methodology link. Share images include the canonical URL. Restricted assets cannot be selected by non-eligible tenants.
- **Data rules:** publishing without evidence fails. Self-review fails. A non-matching quote is rejected.

### CI and operations
- **CI:** typecheck, lint, tests, migration check, preview deployments.
- **Migrations and seeds:** versioned migrations. Seed data covers a fictional test tenant plus a Spain tenant.
  - **All seed parties, quotes and criteria must be obviously fictional** ("Partido Ejemplo A").
- **Security basics:** CSP and security headers, rate limiting on public forms, secrets out of the repo, least privilege.
- **Observability:** error tracking and uptime monitoring.
- **Cost:** prefer free or cheap tiers. Document the expected monthly cost and check current plan terms for a non-profit.
- **Maintainability by volunteers:** boring technology, clear docs, `CONTRIBUTING.md`, ADRs in `docs/adr/`.
- **Licence:** open source. Propose one (e.g. AGPL vs MIT) with reasoning.

---

## 9. Stack: default proposal (challenge it in ADR-0001)

- Next.js (App Router), server-generated share images (e.g. Satori / `@vercel/og`), static or incremental regeneration
- Supabase: Postgres + RLS + Auth + Storage
- Vercel, or Cloudflare, for hosting and multi-tenant custom domains

Evaluate against at least one serious alternative (e.g. SvelteKit + Cloudflare) on:
- Multi-tenant custom domains + TLS
- Share-image generation
- RLS ergonomics and testability
- Cost and plan terms for a volunteer non-profit
- Maintainability by volunteers
- Speed to the pilot date

---

## 10. Timeline

The Spain pilot must be public **before the official campaign starts** (roughly mid-November if the vote is on 29 Nov). An earlier preview with parties and criteria in a "programme pending" state is valuable.

Suggested milestones (refine in the plan):
- **M0** Plan, ADRs, repo skeleton, CI
- **M1** Schema, RLS, tenant isolation tests, hostname routing (`es` + test tenant)
- **M2** Admin: editorial workflow (draft → review → publish), evidence, history, corrections log
- **M3** Public scorecard (mobile-first), methodology and legal pages, share images
- **M4** LLM extraction assist with verbatim check
- **M5** Hardening: security audit, load test, accessibility audit, launch checklist

If a milestone threatens the date, cut scope **from M4 first**. Manual evidence entry is acceptable for launch; unsourced cells are not.

---

## 11. Open decisions (ask before assuming)

- **Criteria list for Spain:** the chapter supplies it (based on PauseAI's demands). Until then, use fictional placeholders only.
- **Methodology kind for Spain:** expected `demands`.
- **Final product names and domains:** platform umbrella name; Spanish canonical domain.
- **Hosting accounts and who owns them:** the association, not an individual.
- **Licence.**

## 12. Working agreement

- **Plan before code.** Start in plan mode; no application code until the plan and ADR-0001 / ADR-0002 are approved.
- **Never invent political content:** no party positions, quotes, criteria wording or election facts. Anything real comes from the editors.
- **Every milestone ends with green tests and a short demo** of what now works.
- **Ask when ambiguous; push back when the brief is wrong.**
- **Keep `CLAUDE.md` short** (commands, conventions, pointers here and to `docs/adr/`). Put detail in docs, not in `CLAUDE.md`.
