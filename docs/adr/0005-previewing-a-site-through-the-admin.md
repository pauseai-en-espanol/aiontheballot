# ADR-0005: Previewing a site through the admin

- **Status:** Accepted (PLAN D15, R166: Dani chose option A, through the admin, on 2026-10-13). Built (PLAN R174), with
  the spike's result and two changes the build found (below, Decision); gitops turns it on.
- **Date:** 2026-10-12
- **Deciders:** Dani; drafted by Claude
- **Relates to:** BRIEF §2 (authorization never from the Host header; the public app has no sessions or cookies),
  §10 (an earlier preview); [ADR-0001](0001-hosting-and-delivery.md) (gateways);
  [ADR-0002](0002-tenancy-and-authorization.md) (§1 routing, §3 sessions);
  [ADR-0003](0003-application-stack.md) (§1 the admin reaches data only through the API); public-site spec §2
  (modes); PLAN R121, R135

## Context

A site is _coming soon_ until a platform admin opens it (PLAN R135). Before that, its members need to see its real
pages: an election that went live shows its parties, criteria and cells to the public role (RLS), but the site's public
addresses still serve only the coming-soon home. The public-site spec (§2) gives that view a _preview mode_: every page
as if open, never indexed, never counted by Plausible. The web app already has it, on a preview host (`PREVIEW_HOST`)
that serves `/{tenant-slug}/…` for every active tenant.

What it lacks is a safe way in. The plan (M3) put the preview host on a private gateway, reachable over a VPN only.
That keeps it from the public, but the people who need it (the chapter's editors and reviewers) aren't on the VPN, and a
VPN account is all-or-nothing: it would show every tenant's preview to anyone given one. What decides who may see a
tenant's unpublished view is its memberships (ADR-0002), and those are checked by the API, for a session that lives
only on the admin host (`__Host-admin.*` cookies, ADR-0002 §3). The public app must stay without sessions or cookies
(BRIEF §2, CLAUDE.md).

Two facts shape the options:

- **The admin host is the only origin with a session.** Anything served on it runs with that origin's rights: a
  script there can call `/api` with the member's cookie, and the API takes a write from a page on the admin's origin
  (R97). The public site's pages carry Next's scripts and render party content; a bug in them that is harmless on a
  public host (no session) would become a way to act as the member if those pages ran on the admin's origin.
- **Both Next apps serve their assets at `/_next/…`.** A public page served under the admin's host names the web app's
  CSS and fonts at paths the admin already uses for its own.

## Options considered

### A. Through the admin (recommended)

The admin gets one route, `/t/{tenant}/preview/{path…}`. For each request it:

1. asks the API whether the session may open the tenant (`GET /api/t/{tenant}`, as every admin page does): members of
   the tenant, any role, and platform admins; anyone else gets the admin's 404;
2. fetches the page from the web app inside the cluster (`WEB_URL`), with the preview host's name as `Host` and a
   shared secret header (`PREVIEW_TOKEN`, a gitops secret given to the web app and the admin only), nothing of the
   browser's request but the path and the language;
3. returns it with a header set of its own: `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'
data:; style-src 'self'; font-src 'self'` (no script runs, and the page has an opaque origin, so it can't use the
   admin's session even if a bug let it try), `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`,
   `X-Robots-Tag: noindex`.

The web app serves preview mode only for a request on the preview host that carries the token, and builds the
preview's links under the root the admin gives it (`PREVIEW_ROOT`, e.g. `/t/{slug}/preview`), so navigation stays in
the admin. Its assets move under a prefix of their own (`assetPrefix`, a spike decides between that and rewriting
`/_next/static/` in the preview's HTML and CSS), which the admin passes through for CSS, fonts and images only.
`PREVIEW_HOST` becomes an in-cluster name no gateway routes.

- **For:** one rule decides access, the API's membership check, already tested and audited; no gateway or DNS change,
  no new host or certificate; works for members wherever they are; the public app stays cookie-free and never sees a
  session; no script from the public site ever runs on the admin's origin. The secret header means a pod that reaches
  the web app inside the cluster still can't ask for preview mode.
- **Against:** the preview runs without JavaScript (the public pages render on the server, so it shows what matters,
  but the share dialog and the signup form don't work there); asset paths need the spike above; the admin's pods carry
  the preview's traffic (a few members, small).

### B. Envoy external authorization on a path

The gateway routes `admin.{domain}/preview/…` to the web app (preview mode), and an Envoy Gateway `SecurityPolicy` with
`extAuth` asks the API, per request, whether the cookie's session may see the tenant in the path.

- **For:** no proxying code in the admin; the gateway streams the response.
- **Against:** the rule that guards unpublished content lives in gateway configuration (gitops), outside the app's
  tests, where a mistake (a path match, failing open) exposes it; every asset is an authorization round trip; the web
  app's scripts would run on the admin's origin unless the web app adds the same sandboxing headers in preview mode;
  the `/_next/…` clash is the same; the local stand-in gateway (`e2e/fake-gateway.ts`) would have to emulate ext-auth
  for the end-to-end tests. The cookie is host-only, so this can't move to a host of its own without a second sign-in.

### C. Keep the VPN-only preview host

- **For:** built (R121); nothing new.
- **Against:** members need VPN accounts, which grant every tenant's preview and more of the network than they need;
  access isn't tied to memberships, so it isn't audited per tenant.

## Decision

**A**: preview through the admin, script-free and sandboxed, behind the API's membership check, with the web app's
preview mode reachable only in the cluster and only with the shared token (PLAN D15, R166). Built in PLAN R174.

**The spike** (both apps' `/_next/` on one host). Next.js 16 strips an `assetPrefix` only in development: in production
it expects a CDN or proxy to, so a prefix would have changed every public page's asset URLs and needed stripping at
the gateway or in the web app's proxy. The other way needs no change to the public site: the web app's built CSS names
its fonts relatively (`../media/…`), so only the page's own references to `/_next/static/` need moving. The admin
rewrites them to `/preview-static/…` in the preview's HTML and serves that path from the web app's `/_next/static/`
(content-hashed stylesheets and fonts only).

**Changes from option A as drafted:**

- **`sandbox allow-same-origin`, still without `allow-scripts` or `allow-forms`.** With a fully opaque origin the
  browser sent no session cookie with the page's own images (the sites' logos, behind the same membership check) and
  refused its fonts (CORS). Keeping the admin's origin lets the page load them; with no script and no form, that is all
  it can do with it, which is what the opaque origin was for.
- **The preview's scripts are stripped**, not only refused: each refusal was a request and a console error for
  nothing. Links and images work; the share dialog and the forms don't (as drafted).
- **Its headers:** `Referrer-Policy` is the admin's own `same-origin`, which its configuration sets on every answer;
  the policy also allows the page's inline styles and adds `form-action 'none'`, `base-uri 'none'` and
  `frame-ancestors 'none'`. A signed-out visitor is sent to sign in, as on every admin page; anyone else the API
  refuses gets an empty 404.

Also built: the web app reads the host as `resolve()` does (lowercase, without a port) before asking for the token,
links and redirects under the root the admin gives it (`/t/{slug}/preview`), and a 404 for anything on the preview
host without the token, `robots.txt` included.

## Consequences

If A is accepted:

- **New configuration:** `PREVIEW_TOKEN` (a gitops secret for the web app and the admin,
  `scripts/seal-preview-token-secret.sh`), `PREVIEW_HOST` for both, `WEB_URL` for the admin (the charts' `preview:`
  blocks), and a NetworkPolicy rule letting the admin reach the web app. The root is no setting: the admin sends it with
  each request (`x-aiontheballot-preview-root`), and the web app takes it only with the token.
- **ADR-0002 amended:** a second way the admin host shows tenant content (served, not read through `/api`), with the
  same membership rule; the web app's preview mode requires the token, so the Host header still grants nothing.
- **Tests:** a non-member and a signed-out visitor get 404 for every preview path; the web app refuses preview mode
  without the token, and on any public host; the preview's responses carry the sandboxing CSP; no `Set-Cookie` from
  the web app in any mode.
- **Amended (PLAN R181): elections in preview.** The preview also shows an election in preview (between draft and
  live), which the public never sees, on a site already open as on one coming soon. The web app's preview mode reads
  its data from the API's `/preview` routes, sending the same secret, and the API reads it as its own role,
  `aiontheballot_preview` (ADR-0002 §2, §7), which sees elections in preview and what the public sees, never a draft's
  content. Its data loaders and logos' cache keys are apart from the public's; share images are cached by the hash of
  what they show, so the same picture serves both only for the same content, and none is pre-rendered for the preview.
  A page takes the preview's mode only with the secret, and the API checks at startup that each login is its role.
- **Revisit** if members need the preview's scripts (then a sandbox with `allow-scripts` and no `allow-same-origin`,
  checked against what the scripts call), or if a tenant gets its own admin host (ADR-0002, D3).
