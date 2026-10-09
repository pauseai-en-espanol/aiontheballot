# ADR-0001: Hosting and delivery

- **Status:** Proposed
- **Date:** 2026-10-08
- **Relates to:** BRIEF §6, §8, §9, §10, §11; [ADR-0002](0002-tenancy-and-authorization.md),
  [ADR-0003](0003-application-stack.md)

The brief asked for one ADR covering stack and hosting. The owner wants to choose the application stack a little
later, so this ADR covers **hosting and delivery** only. The framework, auth library and tooling choices are in
ADR-0003.

## Context

**What the brief requires:**

- The Spain pilot is public before the official campaign starts (BRIEF §10).
- Volunteers can maintain it.
- It runs on free or cheap tiers.
- It survives viral traffic spikes.
- Tenants get custom domains, and TLS is issued only for verified hostnames.
- Share images are generated server-side.
- Tenant isolation is enforced by Postgres RLS and tested at the database level.

**What the owner decided:** deploy on the existing GitOps-managed cluster `danilupion-com`.

**What that cluster runs today** (from the `gitops` repo):

| Area               | Components                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Cluster            | kubeadm 1.36, **one node** (8 threads, 64 GiB), shared with Mailu, Jitsi and other apps                                                  |
| Delivery           | Argo CD (ApplicationSets), SealedSecrets, Harbor (`harbor.danilupion.com`)                                                               |
| Networking and TLS | Envoy Gateway (`gateway-public` on `176.9.123.86`, plus a private tier), cert-manager (DNS-01 via Cloudflare), external-dns (Cloudflare) |
| Shared services    | Postgres 18.6, Mailu (with Brevo and SMTP2GO relays), Plausible                                                                          |

**Gaps relevant to this project:**

- No backups yet (`backup-policy-plan.md` is at 0/11).
- No CDN, WAF or rate limiting.
- No object storage.
- No in-cluster monitoring beyond Argo CD notifications to Telegram.

## Options considered

Prices and terms were checked against official pages when this ADR was written (see its date).

### A. Brief default: Next.js + Supabase Pro + Vercel Pro

- **Domains and TLS:** a domains API, apex via A record, automatic certificates.
  ([docs](https://vercel.com/docs/platforms/multi-tenant-platforms/limits))
- **Share images:** `next/og`, with a 500 KB bundle cap and CPU billed per render.
- **Vercel cost and terms:**
  - Hobby is "restricted to non-commercial personal use only", has one seat, and its content may be used for AI
    training. That rules it out.
  - Pro is $20/month including $20 of usage credit.
    ([fair use](https://vercel.com/docs/limits/fair-use-guidelines), [Pro](https://vercel.com/docs/plans/pro-plan))
- **Supabase cost and terms:**
  - Free pauses after a week of inactivity and has no backups.
  - Pro is $25/month. ([pricing](https://supabase.com/pricing))
- **Total:** about **$47–50/month**.
- **Vendor changes to absorb:**
  - Supabase is retiring its legacy anon/service_role keys.
  - Vercel's new Flat-Rate CDN pricing is described differently on its pricing
    page and in its docs.

### B. SvelteKit or Next.js on Cloudflare Workers, with Supabase

- **Pricing:** Workers Paid is $5/month, static assets are free, and there are no egress fees.
  ([pricing](https://developers.cloudflare.com/workers/platform/pricing/))
- **Total:** about **$30/month** with Supabase Pro.
- **Domains:**
  - A tenant whose DNS is elsewhere needs Cloudflare for SaaS: 100 custom hostnames free, but an apex domain
    needs CNAME flattening at the tenant's DNS provider, or Enterprise.
    ([plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/))
- **Framework risk:**
  - SvelteKit 3 is a brand-new major version.
  - Cloudflare now recommends experimental vinext over OpenNext for new Next.js apps.
  - Running `next/og` on OpenNext is unverified.

### C. danilupion-com, following the gifcept pattern (chosen)

- **Cost:** about **€0/month** extra. The domain is already bought; LLM usage is capped separately.
- **Pipeline:** the same one every other app on the cluster uses (`gitops/docs/app-onboarding.md`).
- **Testing RLS:** plain Postgres 18 with explicit runtime roles. Tests run against a real Postgres 18, and there
  is no public Data API to secure.
- **Share images:** Satori and resvg in Node. No platform caps; renders use CPU on our node and are cached by
  content hash.
- **To build:**
  - DB runtime roles (D1).
  - Off-node backups (D2), which come from the cluster's backup plan.
  - A certificate SAN for `iaenlasurnas.es`.
- **Risks:** a single shared node with a **bus factor of one**.

| Criterion                      | A                                  | B                                               | C                                          |
| ------------------------------ | ---------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Custom domains and TLS         | Strong                             | Strong for zones we own; weak for tenant apexes | A gitops PR per verified host, not dynamic |
| Share images                   | Good, with caps                    | Unverified                                      | Good, no caps                              |
| RLS ergonomics and testability | Good (Supabase stack)              | Good (Supabase stack)                           | Best (plain Postgres, no public API)       |
| Cost and plan terms            | About $50/month                    | About $30/month                                 | About €0/month                             |
| Volunteer maintainability      | Vendor-managed                     | Adapter churn                                   | Known pipeline; bus factor of one          |
| Speed to pilot                 | Fast, but new accounts and billing | Adapter and image risk                          | Fast; pipeline already exists              |

## Decision

**C. Deploy on `danilupion-com` following the gifcept onboarding pattern.** Where gifcept has known problems, we
fix them rather than copy them.

### Repository, chart and CD

- **Repository:** `pauseai-en-espanol/aiontheballot`.
- **Umbrella chart:** `helm-charts/aiontheballot`, with one subchart per deployable (`apps/*/helm-chart`: web, admin,
  API, worker) and a migration Job.
- **Routes:** the halyard `route:` convention (`enabled`/`parentRefs`/`hostnames`/`annotations`) on
  `gateway-public`.
- **Pods:**
  - Dependency-free `/healthz` probes.
  - A `preStop` sleep, and Node keep-alive set above the Envoy idle timeout.
  - Unlike gifcept, explicit **resource requests and limits** and a **restrictive securityContext**, because the
    node is shared.
- **Images:**
  - Tagged `harbor.danilupion.com/aiontheballot/<component>:<version>.<sha>`, never `:latest`.
  - The base image is pinned by digest.
- **CI:**
  - Runs on the `pauseai-en-espanol` self-hosted runner, with actions pinned by SHA.
  - Changesets bump versions, `turbo docker:push` pushes images, and a pinned `yq` writes the image tags into the
    umbrella chart's `values.yaml`.
  - One release workflow runs after CI passes on `main`, on the exact commit CI tested. It rebuilds each deployable
    whose package version is ahead of its tag in the chart, so a failed or skipped release is picked up by the next.
  - No `pull_request_target` workflows.
  - **CI never holds cluster credentials;** Argo CD pulls.
- **Sync order:** the gitops Secrets and the default ServiceAccount patch (wave -2), then the migration Job (a
  Sync hook in wave -1), then everything else. Not a PreSync hook: on a first sync it would run before the Secrets
  and the pull secret exist. Migrations are expand/contract, because old pods serve until the rollout finishes.
- **One environment: production.** There is no staging instance:
  - Until the preview, production publishes nothing (it shows "coming soon"), so it is where deployments are
    tried.
  - CI already runs the database tests against Postgres 18 with the production roles, and the smoke tests
    against production builds.
  - A public copy filled with fictional parties and ratings could be passed around as real.
  - A second environment on the shared Postgres would need its own runtime roles (see Database).
- **Promotion:**
  - Until the preview, production tracks the chart at `main`, so every release deploys.
  - Before the preview, it switches to a `production` branch. From then on, deploying means fast-forwarding
    `production`, which the owner does; the branch decides when changes go live.
- **Previews:** there are no per-PR preview deployments (BRIEF §8; see PLAN.md, P13).

### GitOps entries

- `catalog/apps/aiontheballot/applicationset.yaml` discovers
  `clusters/danilupion-com/values/apps/aiontheballot.yaml` and deploys `helm-charts/aiontheballot` into the
  `aiontheballot` namespace.
- SealedSecrets go in `clusters/danilupion-com/resources/apps/aiontheballot/`, plus the database passwords in
  `resources/data/postgresql/`. `scripts/seal-gitops-secrets.sh` generates and seals all of them in one run, so
  each password is created once and never printed.
- The repo and namespace are added to `projects/apps.yaml`.
- Harbor gets an `aiontheballot` project with pull and push robots.

### DNS and TLS

- The `iaenlasurnas.es` zone sits on Cloudflare **as DNS only** and is added to the external-dns
  `domainFilters` and to the `gateway-public` certificate SANs.
- `elecciones.pauseai.es` is already covered by the `*.pauseai.es` wildcard certificate.
- A tenant hostname gets its route and certificate SAN only after it is verified in the database (ADR-0002).
- Retired hostnames are **never** removed from DNS, routes or the certificate, because shared images carry them.

### Database

- Postgres 18, with runtime roles that do not own anything (ADR-0002).
- Reachable only inside the cluster: ClusterIP, no NodePort.
- The shared `postgresql` instance, with an `aiontheballot` database. The apps never connect as the role that owns the
  tables: an owner bypasses RLS and can disable policies and triggers.
- The runtime roles `aiontheballot_web`, `aiontheballot_admin` and `aiontheballot_worker` come from the halyard
  `postgresql` chart's `databases[].extraRoles` (chart 1.1.0): login roles that own nothing and are forced to
  `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Our migrations, run as the owner, grant them
  table privileges.
- Role names belong to the whole Postgres server, and the migrations grant to these fixed names. A second
  environment on the same server would have to share the roles and their passwords (halyard also rejects a role
  listed under two databases), so it would need its own Postgres instance.

### Files

- Stored **in Postgres**: `app.files` holds metadata and `app.file_blobs` holds the bytes (bytea), addressed by
  SHA-256 and immutable.
- RLS protects them like any other table, and the database backup covers them.
- Limit of 50 MB per file. Above 2 GB in total, move the bytes to S3-compatible storage behind the same interface.

### Backups

- Backups follow the cluster's backup plan (gitops `docs/backup-policy-plan.md`, PLAN.md D2). There is no
  app-owned backup job.
- The shared Postgres dumps every database nightly with `pg_dump -Fc`, `aiontheballot` included. Velero copies
  the dumps off the node to MinIO, encrypted by kopia. Nightly is enough, also during the campaign.
- It must work before the preview, including one restore of an `aiontheballot` dump. A full restore drill plus
  runbook is part of M5.

### Traffic spikes without a CDN

- Public pages are served from an in-app cache keyed by the published version. A page view never queries
  Postgres.
- `Cache-Control` with `stale-while-revalidate` for browsers. Images use content-hash URLs marked `immutable`.
- The public web and the API each run at least 2 replicas (`pauseai-es` precedent), with explicit resource
  requests and limits. Background jobs run in the separate worker (ADR-0003).
- An Envoy Gateway `BackendTrafficPolicy` applies a per-IP rate limit to the report and image endpoints. Client
  IPs reach the gateway intact through Cilium.
- An M5 load test measures requests per second for HTML and for images, and how much uplink headroom is left.
  Where it runs is open (PLAN.md, D6).

**Contingency (documented and tried once before launch, see PLAN.md D6; not enabled for launch):** put
Cloudflare's proxy in front. The dashboard toggle alone is not enough, because:

- **external-dns would undo it.** Set the `external-dns.alpha.kubernetes.io/cloudflare-proxied: "true"`
  annotation on the HTTPRoute instead.
- **SSL mode must be Full (strict).** The origin's Let's Encrypt certificate satisfies it.
- **Proxying doesn't cache pages.** HTML caching needs a Cache Rule.
- **Per-IP rate limits degrade.** The gateway strips `CF-Connecting-IP`.
- **The origin stays reachable** directly, so an attacker could bypass Cloudflare.

### Operations

- **Mail:** Mailu sends invitations and password resets (a few dozen emails).
- **Analytics:** Plausible (cookieless).
- **Uptime monitoring:**
  - It must run **off the node**, because a monitor inside the cluster can't detect the node going down.
  - UptimeRobot Free allows commercial use and gives 50 monitors at 5-minute intervals.
    ([terms](https://uptimerobot.com/terms/))
  - One monitor per public hostname, including aliases (which should return 301). Alerts go to Telegram.
- **Error tracking:** self-hosted GlitchTip, using the Sentry SDKs. The apps are instrumented with OpenTelemetry
  from day one, ready for a future cluster-wide OTel backend (ADR-0003).
- **LLM extraction (M4):** the Anthropic API behind an `Extractor` interface.
  - Default model `claude-opus-5-5`, at $4 / $20 per million tokens.
  - The programme text is prompt-cached across criteria.
  - Estimate: about $2 per programme pass, a few tens of dollars per campaign. Cost is recorded per run, with a
    monthly cap.

## Consequences

**Benefits:**

- About €0/month.
- Uses a pipeline the maintainer already operates.
- No public Data API.
- Everything is declarative.

**Costs and risks:**

- **Single shared node.** A node outage takes the site down, and a flood against `176.9.123.86` also hits mail
  and Jitsi. Mitigations: caching, rate limits, the Cloudflare contingency, and a re-homing runbook in M5.
- **Bus factor of one on the cluster.** BRIEF §11 says the association owns hosting accounts; this is a personal
  cluster. For the pilot the cluster is treated as replaceable compute: the association owns the repo, domain, DNS
  zone, mail sender, error-tracking account and LLM key (PLAN.md, P12).
- **New tenant domains need a gitops PR.** Domains whose DNS is not on Cloudflare would need an HTTP-01 issuer or
  per-host certificates.

**Revisit this decision** after the election, when onboarding a second tenant, or after any outage longer than one
hour during the campaign.
