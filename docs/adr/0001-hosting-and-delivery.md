# ADR-0001: Hosting and delivery

- **Status:** Proposed
- **Date:** 2026-10-08
- **Relates to:** BRIEF §6, §8, §9, §10, §11; [ADR-0002](0002-tenancy-and-authorization.md),
  [ADR-0003](0003-application-stack.md), [ADR-0004](0004-file-bytes-on-a-volume.md)

The brief asked for one ADR covering stack and hosting. The owner wants to choose the application stack a little
later, so this ADR covers **hosting and delivery** only. The framework, auth library and tooling choices are in
ADR-0003.

The deployment's specifics (cluster, registry, gateways, DNS, secrets and backups) live in the private gitops
repository. This ADR records what the app needs from them.

## Context

**What the brief requires:**

- The Spain pilot is public before the official campaign starts (BRIEF §10).
- Volunteers can maintain it.
- It runs on free or cheap tiers.
- It survives viral traffic spikes.
- Tenants get custom domains, and TLS is issued only for verified hostnames.
- Share images are generated server-side.
- Tenant isolation is enforced by Postgres RLS and tested at the database level.

**What the owner decided:** deploy on self-hosted Kubernetes that the owner already operates, managed through a
private gitops repository with Argo CD.

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

### C. Self-hosted Kubernetes through gitops (chosen)

- **Cost:** about **€0/month** extra, on infrastructure that already exists. The domain is already bought; LLM usage
  is capped separately.
- **Pipeline:** an existing one: Helm charts, deployed by Argo CD from the private gitops repository.
- **Testing RLS:** plain Postgres 18 with explicit runtime roles. Tests run against a real Postgres 18, and there
  is no public Data API to secure.
- **Share images:** Satori and resvg in Node. No platform caps; renders use our own CPU and are cached by content
  hash.
- **To build:**
  - DB runtime roles (D1).
  - Backups kept off the node (D2), which come from the cluster's backup plan (gitops).
  - A certificate SAN for `iaenlasurnas.es`.
- **Risks:** one operator, a **bus factor of one**.

| Criterion                      | A                                  | B                                               | C                                          |
| ------------------------------ | ---------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Custom domains and TLS         | Strong                             | Strong for zones we own; weak for tenant apexes | A gitops PR per verified host, not dynamic |
| Share images                   | Good, with caps                    | Unverified                                      | Good, no caps                              |
| RLS ergonomics and testability | Good (Supabase stack)              | Good (Supabase stack)                           | Best (plain Postgres, no public API)       |
| Cost and plan terms            | About $50/month                    | About $30/month                                 | About €0/month                             |
| Volunteer maintainability      | Vendor-managed                     | Adapter churn                                   | Known pipeline; bus factor of one          |
| Speed to pilot                 | Fast, but new accounts and billing | Adapter and image risk                          | Fast; pipeline already exists              |

## Decision

**C. Deploy on self-hosted Kubernetes, managed through the private gitops repository with Argo CD.** Where the
cluster's usual way of onboarding an app has known problems, we fix them rather than copy them.

### Repository, chart and CD

- **Repository:** `pauseai-en-espanol/aiontheballot`.
- **Umbrella chart:** `helm-charts/aiontheballot`, with one subchart per deployable (`apps/*/helm-chart`: web, admin,
  API, worker) and a migration Job.
- **Routes:** Gateway API HTTPRoutes, from each chart's `route:` values (`enabled`/`parentRefs`/`hostnames`/
  `annotations`). The gateway and the hostnames are set in gitops.
- **Pods:**
  - Dependency-free `/healthz` probes.
  - A `preStop` sleep, and Node keep-alive set above the gateway's (Envoy's) idle timeout.
  - Explicit **resource requests and limits** and a **restrictive securityContext**, so the app shares a cluster
    safely.
- **Images:**
  - Tagged `<registry>/aiontheballot/<component>:<version>.<sha>`, never `:latest`. The registry is the release
    runner's `DOCKER_REGISTRY`, set outside the repository.
  - The base image is pinned by digest.
- **CI:**
  - Amended (PLAN R120): pull requests run on GitHub-hosted runners (`ubuntu-24.04`). The repository is public, so a
    pull request's code, a fork's included, never runs on our runner. Pushes to `main`, manual runs and the release
    run on the `pauseai-en-espanol` self-hosted runner, the only one that can push images to the registry. Both run
    the same jobs. Actions are pinned by SHA.
  - Changesets bump versions, `turbo docker:push` pushes images, and a pinned `yq` writes the image tags into the
    umbrella chart's `values.yaml`.
  - One release workflow runs after CI passes on `main`, on the exact commit CI tested. It rebuilds each deployable
    whose package version is ahead of its tag in the chart, so a failed or skipped release is picked up by the next.
  - No `pull_request_target` workflows.
  - **CI never holds cluster credentials;** Argo CD pulls.
- **Dependency updates** (amended, PLAN R120): Renovate opens and updates PRs only in a window early on Monday,
  Europe/Madrid: one PR for every non-major update (patch, pin, minor and digest updates together), majors on their
  own (a whole monorepo together, as Renovate's presets group them), and lock-file maintenance in its own PR. It
  rebases a PR only when it conflicts. Security fixes are raised at once, whatever the window, as Renovate always
  does. The 3-day minimum release age stays (ADR-0003).
- **Sync order:** the gitops Secrets and the default ServiceAccount patch (wave -2), then the migration Job (a
  Sync hook in wave -1), then everything else. Not a PreSync hook: on a first sync it would run before the Secrets
  and the pull secret exist. Migrations are expand/contract, because old pods serve until the rollout finishes.
  Argo CD syncs only when a regular resource differs, and never compares hooks, so the umbrella chart carries a
  ConfigMap of the release's image tags: a release that changes only the migration image still syncs and runs it.
- **One environment: production.** There is no staging instance:
  - Until the preview, production publishes nothing (it shows "coming soon"), so it is where deployments are
    tried.
  - CI already runs the database tests against Postgres 18 with the production roles, and the smoke tests
    against production builds.
  - A public copy filled with fictional parties and ratings could be passed around as real.
  - A second environment on the same Postgres server would need its own runtime roles (see Database).
- **Promotion:** production tracks the chart at `main`, so every release deploys.
  - Amended (PLAN R166, the owner's decision): no `production` branch, though this ADR had planned one before the
    preview. With no staging, a branch to promote would only delay what nobody could see first, and would keep
    whoever pushed from checking their own deploy.
  - During the code freeze (launch until the election is archived), nobody pushes to `main` on their own: changes
    come as pull requests the owner merges, and hotfixes are the owner's.
- **Previews:** there are no per-PR preview deployments (BRIEF §8; see PLAN.md, P13).

### GitOps entries

The private gitops repository holds the deployment:

- an Argo CD application that deploys `helm-charts/aiontheballot` into the `aiontheballot` namespace, with the
  deployment's values;
- the SealedSecrets: the apps' and the database passwords. `scripts/seal-gitops-secrets.sh` generates and seals all
  of them in one run, so each password is created once and never printed;
- the registry's pull and push credentials.

### DNS and TLS

- `iaenlasurnas.es` gets its DNS records and a SAN on the public gateway's certificate through gitops.
- Amended (PLAN R134): no `elecciones.pauseai.es` alias; `iaenlasurnas.es` is the site's only hostname.
- A tenant hostname gets its route and certificate SAN only after it is verified in the database (ADR-0002).
- Retired hostnames are **never** removed from DNS, routes or the certificate, because shared images carry them.

### Database

- Postgres 18, with runtime roles that do not own anything (ADR-0002).
- Reachable only inside the cluster: ClusterIP, no NodePort.
- An `aiontheballot` database on a Postgres server the deployment provides (gitops). The apps never connect as the
  role that owns the tables: an owner bypasses RLS and can disable policies and triggers.
- The runtime roles `aiontheballot_web`, `aiontheballot_admin`, `aiontheballot_worker` and `aiontheballot_auth`
  (Better Auth's, ADR-0002 §2) are created by the deployment (gitops) as login roles that own nothing, with
  `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Our migrations, run as the owner, grant them table
  privileges.
- Role names belong to the whole Postgres server, and the migrations grant to these fixed names. A second
  environment on the same server would have to share the roles and their passwords, so it would need its own
  Postgres instance.

### Files

Amended: bytes first lived in Postgres (`app.file_blobs`); the owner moved them out before any were stored (PLAN R61).
[ADR-0004](0004-file-bytes-on-a-volume.md) has the design.

- **Bytes on a persistent volume:** a `ReadWriteOnce` volume of type `local` (the chart's default class is
  `local-path`), mounted by the API at `/data` (and by the worker, once it exists). Each file sits under its tenant,
  bucket and SHA-256 (`files/{tenant}/{bucket}/sha256/ab/cd/…`; `files/platform/…` for brand assets), written once
  through a store that computes the hash, checks it again on every read, and never changes the bytes.
- **The rules stay in Postgres.** `app.files` keeps each file's row (tenant, bucket, type, size, hash), and RLS decides
  who sees it; the API reads bytes only for a row it can see, from that row's own folder.
- Bytes are written before their row, so a row never names missing bytes. Bytes no row names are swept after a grace
  period at least as long as the database backups are kept.
- Limit of 50 MB per file (2 MB for brand images). The default class doesn't enforce the volume's size: the node's
  disk is the limit.
- **One node** (ADR-0004's design): the volume is a folder on that node, so every replica shares it. A second node
  would need shared storage, or object storage behind the same store interface.
- **Backups:** the database's backups don't cover the volume. The cluster's backup plan (gitops) must copy it too,
  each copy taken after the database backup it goes with (ADR-0004).

### Backups

- Backups follow the cluster's backup plan (gitops, PLAN.md D2). There is no app-owned backup job.
- The plan must cover the `aiontheballot` database and keep its copies off the node. Losing at most a day of edits is
  acceptable, also during the campaign.
- Stored files' bytes are on the API's volume, which the plan must copy too, **after** the database backup
  (ADR-0004).
- It must work before the preview, including one restore of the `aiontheballot` database. A full restore drill plus
  runbook is part of M5 (the runbook is [written](../runbooks/restoring-the-database.md), PLAN R152).

### Traffic spikes without a CDN

- Public pages are served from an in-app cache keyed by the published version. A page view never queries
  Postgres.
- `Cache-Control` with `stale-while-revalidate` for browsers. Images use content-hash URLs marked `immutable`.
- The public web and the API each run at least 2 replicas, with explicit resource requests and limits. Background
  jobs run in the separate worker (ADR-0003).
- An Envoy Gateway `BackendTrafficPolicy` applies a per-IP rate limit to the report, image, error-relay and
  analytics-relay endpoints. Client IPs must reach the gateway intact. Amended (PLAN R158): the limits are global,
  since only Envoy Gateway's rate-limit service (with its Redis) keeps a bucket per address; the web chart renders
  them in its route's own policy (one policy per route), as the admin chart does its error relay's (R208), and
  gitops sets the numbers. They need that service: with a
  number set and the service off, every request of the route gets a 500.
- An M5 load test measures requests per second for HTML and for images, and how much uplink headroom is left.
  Where it runs is open (PLAN.md, D6).

**Contingency (below and in the incidents runbook §7; tried once before launch, see PLAN.md D6):** put a CDN's
proxy in front. Turning it on in the provider's dashboard is not enough, because:

- **DNS automation would undo it** when the records are managed from the cluster: the proxy setting belongs with
  the route (its annotations, set in gitops).
- **The proxy must verify the origin's certificate.** The origin's Let's Encrypt certificate satisfies it.
- **Proxying doesn't cache pages.** HTML caching needs a cache rule.
- **Per-IP rate limits and Plausible's visitor counts break.** The gateway trusts no forwarded client-IP header, so
  both see the proxy's addresses: every visitor shares a few buckets, so the limits are set to 0 first (PLAN R158).
- **The origin stays reachable** directly, so an attacker could bypass the proxy.

### Operations

- **Mail:** an SMTP submission account (gitops) sends invitations and password resets (a few dozen emails).
- **Analytics:** Plausible (cookieless).
- **Uptime monitoring:**
  - It must run **off the node**, because a monitor inside the cluster can't detect the node going down.
  - UptimeRobot Free allows commercial use and gives 50 monitors at 5-minute intervals.
    ([terms](https://uptimerobot.com/terms/))
  - One monitor per public hostname, including aliases (which should return 301), alerting someone who will act.
- **Error tracking:** a Sentry-compatible tracker (GlitchTip, ADR-0003 §7), using the Sentry SDKs. The apps are
  instrumented with OpenTelemetry from day one, ready for a future OTel backend (ADR-0003).
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

- **Self-hosted, on one node.** An outage of the node, or a flood against it, takes the site down. Mitigations:
  caching, rate limits, the CDN-proxy contingency, and a re-homing runbook in M5
  ([written](../runbooks/moving-hosting.md), PLAN R152).
- **Bus factor of one on the cluster.** BRIEF §11 says the association owns hosting accounts; the cluster is the
  operator's own. For the pilot the cluster is treated as replaceable compute: the association owns the repo, domain,
  DNS zone, mail sender, error-tracking account and LLM key (PLAN.md, P12).
- **New tenant domains need a gitops PR.** Domains whose DNS the platform doesn't manage need another way to get
  their certificates (an HTTP-01 challenge, or per-host certificates).

**Revisit this decision** after the election, when onboarding a second tenant, or after any outage longer than one
hour during the campaign.
