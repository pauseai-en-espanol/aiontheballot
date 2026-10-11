# Spec: public site

What the public web app (`apps/web`) shows, at which addresses, and when. It builds on the
[data model](data-model.md) (§5, the public read model), [ADR-0002](../adr/0002-tenancy-and-authorization.md)
(routing and the public-visibility rule) and [ADR-0003](../adr/0003-application-stack.md) §6. Wording marked
_provisional_ waits for the chapter (PLAN P7); every word is a UI string in `packages/i18n`, never content.

- **Status:** drafted for M3 (PLAN R121–R127); awaits Dani's review.

## 1. Principles

- **Everything shown is data the public role may read.** Pages come from the API's public routes, read as
  `aiontheballot_web`, so RLS decides what is public. The web app has no database access, sessions or cookies.
- **The Host header selects content, never access.** The modes in §2 change what a page _shows_ of data that is
  already public; none of them reaches anything RLS hides.
- **One address per page.** Every page has one canonical URL, built from the routing table (never the Host header).
  The default locale has no prefix; other enabled locales do (`/en/…`).
- **No page needs client JavaScript to read or to submit a form.** Scripts only enhance.
- **Ratings are never colour alone:** icon, text and colour together (BRIEF §6), on pages and share images.
- **Nothing invented.** A missing value is left out, never a placeholder. Seeds stay obviously fictional.

## 2. Modes: coming soon, open, preview

A tenant's site is in one of three modes, decided per request by the routing proxy:

| Mode          | Where                                                 | What it serves                                                     |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| _Coming soon_ | The tenant's public addresses, until its site is open | The coming-soon home, the always-on pages (§3.3), and nothing else |
| _Open_        | The tenant's public addresses, once its site is open  | Every page in §3                                                   |
| _Preview_     | The preview host, on `gateway-private` (VPN only)     | Every page in §3, as if open, never indexed                        |

- **Opening a site is configuration:** `OPEN_SITES`, a comma-separated list of tenant slugs, in the web app's
  environment (gitops). A site is open from the deployment that lists it. It is the Preview go/no-go's switch, so
  it sits with whoever runs gitops, and needs no schema change. An unlisted tenant stays coming soon.
- **The preview host** is `PREVIEW_HOST` (unset: no preview). It serves `/{tenant-slug}/…` for every active tenant,
  like the platform host, but never redirects to a canonical host. Its pages say `noindex, nofollow` (meta tag and
  `X-Robots-Tag`), its `robots.txt` disallows everything, and Plausible never counts it (it has no Plausible site).
  Canonical, Open Graph and share URLs on it are the tenant's canonical ones, as everywhere; links between pages stay
  on the preview host.
- The proxy tells pages the mode in a request header it always sets itself (`x-aiontheballot-site`), overwriting
  whatever a client sent; a page reached without it is treated as coming soon.
- **What a site shows depends on its elections too.** Only `live` and `archived` elections are public (RLS). An open
  site with no public election shows the coming-soon home, so opening early shows nothing new. Going live is what
  makes an election's parties and criteria public, to the preview host first while the site stays coming soon.

## 3. Pages and addresses

Paths are relative to the tenant's root: `/` on its own hostname, `/{tenant-slug}` on the platform and preview hosts.
Their words follow the tenant's **default** locale, in every locale, so a page's locales differ only by the prefix:
`/generales-2026/partidos/{party}` and `/en/generales-2026/partidos/{party}`. The words live in `packages/domain`
(`SITE_PATHS`), and the proxy maps them to the app's routes; an English word on a Spanish site is a 404, so each
page keeps one address.

### 3.1 Election pages (open and preview)

| Page        | Path (`es`)                                | Path (`en`)                               |
| ----------- | ------------------------------------------ | ----------------------------------------- |
| Scorecard   | `/{election}`                              | `/{election}`                             |
| Party       | `/{election}/partidos/{party}`             | `/{election}/parties/{party}`             |
| Cell        | `/{election}/partidos/{party}/{criterion}` | `/{election}/parties/{party}/{criterion}` |
| Criterion   | `/{election}/criterios/{criterion}`        | `/{election}/criteria/{criterion}`        |
| Methodology | `/{election}/metodologia`                  | `/{election}/methodology`                 |

The words under an election can't collide with anything, since parties and criteria sit under their own word.

### 3.2 The home

- **Open or preview, with a public election:** `/` answers 307 to the current election's scorecard: the soonest
  `live` election, else the most recently dated `archived` one. 307, since the current election changes.
- **Otherwise:** the coming-soon page (PLAN R42, R82), with the signup form when it is offered (§6).

### 3.3 Always-on pages (every mode)

| Page                 | Path (`es`)           | Path (`en`)            | Content                                           |
| -------------------- | --------------------- | ---------------------- | ------------------------------------------------- |
| Legal notice         | `/aviso-legal`        | `/legal-notice`        | Generated from the operator's `organizations` row |
| Privacy policy       | `/privacidad`         | `/privacy`             | The published `privacy_policy` text               |
| About the operator   | `/quienes-somos`      | `/about`               | The published `about_operator` text, the operator |
| Confirm a signup     | `/avisos/confirmar`   | `/updates/confirm`     | §6                                                |
| Unsubscribe          | `/avisos/baja`        | `/updates/unsubscribe` | §6                                                |
| Signup form's target | `/avisos` (POST only) | `/updates` (POST only) | §6                                                |
| Sitemap              | `/sitemap.xml`        | `/sitemap.xml`         | §8                                                |
| Robots               | `/robots.txt`         | `/robots.txt`          | §8                                                |

They are served before a site opens: the legal notice is owed from the first page (LSSI art. 10), and the signup
form's consent links to the privacy policy. A policy text that isn't published answers 404, and the pages that would
link to it leave the link out. Later (M3, with their workflows): the corrections log, the right-of-reply policy and
the contact and report form.

**Reserved election slugs.** An election's slug can never be a first segment the site serves itself (PLAN R76). The
tenant-level words of every UI language join `RESERVED_ELECTION_SLUGS` and the database's check (migration
`reserved_site_paths`); `sitemap.xml` and `robots.txt` hold a dot, which no slug can. A web test checks that every
word in `SITE_PATHS` at the tenant level is reserved, and the existing route test still covers every route.

## 4. The shared layout (platform invariants, BRIEF §3)

Every page, in every mode, renders in one layout that no tenant setting can change:

- a header with the tenant's name (and its operator mark, when uploaded), linking to the home;
- a footer with **"Una iniciativa de {operator}"** linking to the operator's site (BRIEF invariant 1), in words or
  with the operator's logo; links to the legal notice, the privacy policy (when published) and about the operator;
  and, on election pages, the methodology;
- on every scorecard, party, criterion and cell page, **a link to the election's methodology** next to the rating
  legend (invariant 2);
- a language switch when the tenant has more than one locale, each language named in itself, linking to the same
  page in that locale.

A crawler test (e2e) visits every page of a seeded open tenant and checks the operator line on all of them and the
methodology link on every scorecard, party, criterion and cell page.

## 5. Election pages

Shared by all of them:

- **Rating legend:** each rating of the methodology's kind, with its icon, its words and its colour, plus _pending_.
  Icons come from `packages/ui` (fixed rating visuals); colours pass the contrast test against their background.
- **A cell's display states,** from the public data (data model §3.6, ADR-0002 "Pending is not not mentioned"):
  - _rated_: its current revision has a rating;
  - _pending_ (provisional "Pendiente de evaluar"): no published revision; shown with its own neutral icon (three
    dots in a dashed circle), never as "No lo menciona";
  - _withdrawn_ (provisional "Valoración retirada"): its latest revision withdrew the rating; the pending icon, its
    own words, and its history, which says why;
  - "No lo menciona" is a rating like the others, with the documents checked and when.
- **"Actualizado el {date}"** wherever a cell's rating shows, from its current revision.
- **Language:** content in another language than the page's (a text not yet translated, shown in the site's default
  language) carries its own `lang`; quotes and source titles carry their document's language, else the site's
  (WCAG 3.1.2).
- **Wording:** the scorecard's question and the methodology's lead follow the methodology's kind, as the legend does;
  for `demands`, they name the demands' owner, or speak of "the methodology's demands" if the owner isn't public.
- Retired parties and criteria, and their cells, are left out of every page, the dates of latest change included.
- **A party's programme status:** "Programa aún no publicado (comprobado el {date})" while pending, with the date of
  the last check; nothing while published (its sources show on cells). A status never set shows nothing.

### 5.1 Scorecard

- **Desktop (≥ 1024 px, Panda's `lg`):** a table, parties down the side and criteria across the top, always (PLAN,
  Answered: scorecard orientation). Criteria headers use the short title and link to the criterion page; party headers
  show the logo or colour swatch, the short name (the full name in an `abbr` title and, after it, in text only screen
  readers read) and the programme status, and link to the party page. Each cell is a link to the cell page with the
  rating's icon and words. Past about 8 criteria the party column stays fixed and the table scrolls sideways inside
  its own region (with a visible focus and a label), never the page. It is a real `<table>`, with `<th scope>` headers
  and a caption.
- **Mobile:** one card per party, in the parties' order, each listing every criterion with the party's rating, and a
  second view, one card per criterion listing every party. Both are server-rendered; a two-link switch above them
  picks one (`?vista=criterios`, plain links, so it works without scripts; the canonical address has no query).
- Above the table: the election's name and date, the legend with the methodology link, and the date of the latest
  change on the page.
- With no criteria or no parties yet, the page says so in words rather than drawing an empty table.

### 5.2 Party, criterion and cell pages

- **Party:** its name, logo, website, programme status, and a list of every criterion with the party's rating, the
  cell's short summary and a link to the cell.
- **Criterion:** its title and description, and every party's rating on it, with links to the cells.
- **Cell:** party and criterion; the rating (or pending); the summary; each quote with its source (title, a link to
  the source, page or section, retrieved on, the archived snapshot, the SHA-256 of our stored copy); for "No lo
  menciona", the documents checked and when; the history of published revisions, newest first, each with its date,
  rating, change kind and public note. A pending cell says so, with the party's programme status.

### 5.3 Methodology

The methodology's kind and what its ratings mean (the legend in full), whose demands for `demands` (the owner, with a
link), the body (Markdown, rendered and sanitized: headings, lists, links, emphasis; no raw HTML, no images), and the
external reviewers with their affiliations.

## 6. "Avísame cuando esté listo": the signup list (PLAN R119)

- **Shown on the coming-soon home only when** the API can send mail (R115's sender is configured), the tenant has a
  published privacy policy, and the emails' links have an address (its own hostname, or the platform's path).
  Otherwise the section is left out.
- **The form:** an email field; an optional, unticked box "Avísame también de futuras elecciones en este sitio"; a
  consent line linking to the privacy policy; and a line saying a confirmation email follows, that unconfirmed
  addresses are deleted after 7 days, and that the address is used only to say when the site is ready (and, if
  ticked, for future elections here), then deleted. It posts to `/avisos` (`/updates`) with no script; the page
  answers 303 back to the home with the outcome in the query (`?aviso=…#avisos`), which the home shows in a status
  region. Neither the outcome nor how long it takes says whether an address was already on the list: the
  confirmation email goes out after the answer.
- **Confirming:** the email links to `/avisos/confirmar?t={token}`, a page with one button that posts the token back.
  A GET never confirms, so link scanners can't. Confirmed, the page says what happens next.
- **Unsubscribing:** every email after the confirmation carries `List-Unsubscribe` and `List-Unsubscribe-Post`
  (RFC 8058) pointing at `/avisos?action=unsubscribe&t={token}`, which a mail client posts to; its body links to
  `/avisos/baja?t={token}`, a page with one button.
- The tokens are 256-bit random values, stored as SHA-256 (R119). Pages that show a token are `noindex`, send no
  referrer, and drop the token from the address once used.

## 7. Security headers

On every response of the web app, pages, images, routes and build assets alike (`headers` in `next.config.js`):

- `Content-Security-Policy`: `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (and `'unsafe-eval'` only
  under `pnpm dev`, for React's development build); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data:`;
  `font-src 'self'`; `connect-src 'self'`; `manifest-src 'self'`; `form-action 'self'`; `frame-ancestors 'none'`;
  `base-uri 'none'`; `object-src 'none'`. No nonces, as ADR-0003 sets for the public site, so scripts allow inline
  code: Next writes each page's data into inline scripts. Nothing loads from another host. Whether to move to nonces,
  now that pages render per request anyway, is a question for Dani (PLAN R126). Colours that come from data (a
  party's) are SVG fills, never style attributes.
- `Strict-Transport-Security: max-age=31536000` on https (no `includeSubDomains`: a tenant's hostname may be a
  subdomain of a domain it doesn't control alone, such as `elecciones.pauseai.es`).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (the token pages send no
  referrer at all), `Permissions-Policy` denying camera, microphone, geolocation and the like,
  `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`.
- Not done: Next sends `x-middleware-rewrite` with the internal path, which its client router reads; it names nothing
  private.

An e2e test checks the headers on a page, an image and a route handler, and that no page logs a CSP violation.

## 8. Canonical URLs, sitemaps and robots

- `rel=canonical`, `og:url` and `hreflang` alternates (every enabled locale plus `x-default`) on every page, from the
  routing table.
- `/sitemap.xml` per tenant, at its root in its default locale, on its canonical base: every page the site serves
  in its mode, in each language, with its `hreflang` alternates and, where known, the date of its latest change. A
  coming-soon site lists its home and its always-on pages.
- A site whose home redirects to an election (open, or on the preview host) leaves the home out of its sitemap.
- `/robots.txt` per host, at its root, where crawlers read it: on a canonical host, the site's, allowing everything
  and naming its sitemap; on an alias it isn't served (aliases redirect); on the preview host, disallow everything; on
  the platform host, allow everything and name the sitemap of each site whose canonical base it is. The proxy answers
  the last two itself, since no site is at their root.
- `<html lang>` is the page's language, from a header the proxy sets with the mode.

## 9. Performance and caching

- Pages are rendered per request from the web app's copy of the tenant's public data, refreshed at most every 60
  seconds and kept when the API fails (ADR-0003 guardrail 3), as the home data already is (PLAN R45). An election's
  data is read in one snapshot, and fetched only for an election the home lists: any other slug is a 404 that never
  reaches the API. On-publish revalidation (M2, PC1) shortens that later.
- Budgets (PLAN, social sharing): a warm page under 300 ms of server time; no cookies; no client JavaScript needed.

## 10. Not yet

Share images for every view (the overview, parties, criteria and cells) and their download dialog: until then every
page's link preview is the home's card. When they come, `/og/` serves more than the home's card, so the image route
must refuse an election's cards while the site is coming soon, as the proxy refuses its pages. Also the corrections
log, the contact and report form, structured data and party logos (uploads come with M2). They follow in M3, after
the preview's pages.
