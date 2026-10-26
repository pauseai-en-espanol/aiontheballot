# @aiontheballot/domain

## 0.16.1

### Patch Changes

- 41136b9: Dependencies bump

## 0.16.0

### Minor Changes

- 3859ae8: Share images never cut the criteria's key or a title: the legend and the key take the lines they need, and titles go
  across their columns only where all fit whole. The go-live checklist warns past 16 parties or 12 criteria.

## 0.15.0

### Minor Changes

- bda934d: An election has an optional introduction, Markdown per language, written by its editors on the election form and
  shown above its summary; it needs the default language once in preview or live, and once live it changes only through
  a change request. The public and preview roles read it by a column grant.
- c7a7105: An election's page opens on its summary: the editors' introduction, every party's rating on every criterion as an
  icon, the legend right under it, and a link to the detailed table, now at /{election}/tabla. Only the summary keeps the
  legend; the pages whose ratings show their words keep the methodology link. A party whose programme isn't published
  says so under its name in the summary. "Compartir" opens a dialog that needs no script, the link first and the image
  second, and the footer is a band of its own.

## 0.14.1

### Patch Changes

- 1ffae74: Dependencies bmp

## 0.14.0

### Minor Changes

- 83137c3: Clip times are written as minutes and seconds; a report can be decided at once, its choices explained; a new site's
  country is chosen by name; the methodology and legal texts show a preview rendered as the public site renders them,
  whose renderer now lives in the domain package (PLAN R196, admin forms step 9).

## 0.13.0

### Minor Changes

- f5ab992: A live election's party, criterion, reviewer, methodology or the election itself changes through one request for
  any of its fields at once, each shown beside what it is now, with one public note: proposed, reviewed and applied as
  one, and listed field by field in the change list and both corrections logs; a party's new logo is uploaded first
  (PLAN R183). The party form takes the logo, previewed before it is uploaded, also when creating a party; a new party
  has no colour until someone picks one; the party page shows its name and logo first and stays put after a save;
  the list shows each party's logo and what it still lacks. Invitations start on the editing role, and the
  organization form says which legal details only a site's operator needs.

## 0.12.0

### Minor Changes

- d7e62ac: An election can go to preview before it goes live: its site's members see it in the admin's preview as the public
  will, and edit it as a draft, while the public sees none of it, read through a database role of its own (PLAN R181).

## 0.11.0

### Minor Changes

- 3854bad: Country admins choose their site's colour in Settings, and the public site and its share images take it, with the
  text that reads on it; parties' colours show beside their names on the share images (PLAN R178).

### Patch Changes

- 3d17625: A site's own colour keeps focus rings, borders and the coming-soon page's button visible on it, the public site
  checks a site's colours again as it loads them, and the colour form's reset and contrast ratio read right (PLAN R178).

## 0.10.4

### Patch Changes

- 0cc4860: A site's members preview its public pages through the admin, sandboxed and script-free; the web app's preview host
  answers only with the shared token (ADR-0005, PLAN R174).

## 0.10.3

### Patch Changes

- 7083260: Instant refresh on publish (PLAN R151): after an admin write to a site, the API tells every web replica (through a
  headless Service) to refetch that site and election, and each pre-renders the link previews that changed; the web's
  data caches are one per process.

## 0.10.2

### Patch Changes

- 9224479: The corrections log and the records (PLAN R150): a public corrections log per election with its share card, the
  public data's approved structural changes, each revision's private record in the admin, the election's log in the
  admin, and the audit view for a site's country admins and for platform admins.

## 0.10.1

### Patch Changes

- 3ba6bb4: The right of reply, end to end (PLAN R149): a public form under each election (no cookies, silent spam checks, limits
  per visitor and site), the API's intake as the public role, the admin's triage queue with internal notes and
  anonymizing, change requests that name the report they answer, and a daily CronJob that anonymizes reports past their
  retention.

## 0.10.0

### Minor Changes

- 4516915: Party logos (PLAN R142): uploaded on a party's admin page while its election is a draft (PNG, JPEG or WebP, up to 2 MB
  and 4,096 pixels a side, checked by its own header), and shown beside the party's name on the public pages.

### Patch Changes

- bf4876f: The domain package builds on install, as the share cards' package now imports it (PLAN R142): a fresh install failed.

## 0.9.0

### Minor Changes

- 658a870: A site's public settings are data (PLAN R135): whether it is open, whether search engines may index it, and its
  Plausible script are switches on the site's admin page, for platform admins, instead of `OPEN_SITES` and
  `PLAUSIBLE_SITES` in the web app's environment. A site kept out of search engines answers `noindex, nofollow`
  everywhere, disallows everything in its robots.txt and has no sitemap, for a demo's fictional content.

## 0.8.0

### Minor Changes

- b869a83: The public site's election pages (PLAN R125): the scorecard, with a table on desktops and cards per party or per
  criterion on phones, and the party, criterion, cell and methodology pages, every cell able to show "pending", from a
  new public election route in the API. The fixed rating visuals. Security headers on every response (R126); per-site
  sitemaps and robots, and the page's language in `<html lang>` (R127).
- 7bd93a4: The site's own signup list (PLAN R119, R122): double opt-in through three narrow database functions, a confirmation
  email through the platform's one sender (R115, R123), one-click unsubscribe, unconfirmed addresses deleted after 7
  days, and counts for country admins. The legal notice, privacy policy and page about the operator, served before the
  site opens (R124). Site modes (coming soon, open, preview) and a site's own words in its paths (R121).

### Patch Changes

- 59950f5: The cell editor and the review workflow (PLAN R131): the election's cell grid, and each cell's page to draft a rating
  with quotes checked against their source as they are typed, record checked documents, submit, recall, publish, send
  back with a note, comment, clear a recheck flag and delete a cell never published, at the version loaded.
- 4fc2f00: The quote normalisers follow Unicode's rules on both sides (PLAN R113): letters and spaces are Unicode's Alphabetic
  and White_Space, the database's under `pg_c_utf8`, and a byte-order mark is dropped. The migration stops if any stored
  text would normalise differently.

## 0.7.1

### Patch Changes

- 7ba5873: Dependencies bump

## 0.7.0

### Minor Changes

- 944fcc8: The cell editor's live quote match (editorial workflow C2.6, W13): `matchQuote` in `packages/domain` says whether a
  quote matches its source verbatim and on which pages, exactly as the database will, how much of it does if not, or
  that it is too short or too long to save.
- f10bcac: An election's slug can never be `brand`, `og` or `healthz`, paths the public site serves itself (migration
  `reserved_election_slugs`; `RESERVED_ELECTION_SLUGS` in `packages/domain`).

## 0.6.0

### Minor Changes

- 7f83fd8: Site icons: the platform's default (the coming-soon ballot, marked with the AI sparkle, on an orange tile), or a
  tenant's own square PNG from its new `site_icon` logo slot (a whole PNG, 512 to 1,024 px). Pages name the icons by
  content hash at `/brand/icon/{size}.{hash}.png`, cached as immutable, with `/favicon.ico` and a web manifest. The
  seeds give `ejemplo-a` a fictional icon.

## 0.5.0

### Minor Changes

- 1f4eabe: Tenants' own logos (migration `tenant_brand_uploads`): a brand selection can name one of the tenant's uploaded
  images, public while an active tenant selects it. The API serves the home data's brand images by hash; the web app
  shows the operator's logo in the coming-soon page's header and footer, at `/brand/{sha256}.{ext}` cached as immutable,
  and draws it on the share cards.

## 0.4.0

### Minor Changes

- 0bcb112: Link previews for the coming-soon page: Open Graph and Twitter tags, the canonical address and `hreflang` from the
  routing table, and share images in the four sizes from the new `packages/og` (satori, then resvg, fonts embedded),
  served from content-hash URLs cached as immutable, with 304s. Images are pre-rendered while their page renders and
  when a server starts. The hero's name is sized by the viewport's height too.

## 0.3.0

### Minor Changes

- 2f43760: A tenant's home is now its coming-soon page, in PauseAI's brand: the tenant's name, what the site will do, the next
  public election and the operator's links, all from data, in Spanish and English, on a desktop and a phone. The API
  serves it at `GET /public/tenants/{slug}/home` (read as `aiontheballot_web`); the web app caches each tenant's copy
  and keeps it when the API fails. The shared preset gains the brand colours as semantic tokens, contrast-tested, and
  the self-hosted fonts. The e2e suite checks the page with axe at both sizes.
- d167b29: The coming-soon page offers the operator's newsletter ("Avísame cuando se publique"), from the new
  `organizations.newsletter_url` (migration `organization_newsletter`); the platform collects no addresses. The ballot is
  now an SVG that scales down to a phone, and the tenant's name is sized by its longest word, which never breaks.

## 0.2.0

### Minor Changes

- 902015c: Add public-site routing (ADR-0002): `resolve()` picks the tenant from the Host header and serves, 301s to the
  canonical base or 404s, never falling back to a default tenant; `canonicalBase()`; and a routing table that re-checks
  the hostname invariants. It also parses the locale prefix and reserves `_` paths, so the internal prefix can't be
  requested.

## 0.1.0

### Minor Changes

- 9a83b4d: Add @aiontheballot/db (Kysely client, withActor, generated types) and the TypeScript quote normaliser in @aiontheballot/domain,
  kept identical to private.normalize_for_match() by parity tests against Postgres.
- 6e85ec0: Add the shared domain package (methodology kinds and their rating scales) and the i18n package (English source
  messages, mandatory Spanish checked against them, and a typed translator usable outside Next).

### Patch Changes

- e13c986: Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
  and the i18n JSON include they required, and write the Vitest configs in TypeScript.
- 85ada24: Add the shared Panda preset (@aiontheballot/ui) and the public and admin Next.js skeletons: a translated placeholder page,
  an unlogged /healthz, zoom left enabled, and no cookies or X-Powered-By on the public app. Add the "coming soon"
  message. Build packages without composite/incremental output so a JSON-only change can never leave stale
  declarations.
