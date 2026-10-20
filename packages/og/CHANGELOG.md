# @aiontheballot/og

## 0.7.4

### Patch Changes

- 0894c19: The whole-table image never cuts a rating's words: they are written whole under each icon, on as many lines as the
  longest words need, or left to the legend where they no longer fit, as on the demo's 11 parties and 10 criteria.
- Updated dependencies [bda934d]
- Updated dependencies [c7a7105]
  - @aiontheballot/domain@0.15.0
  - @aiontheballot/ui@0.4.5

## 0.7.3

### Patch Changes

- 5e3e7a7: From the security audit (PLAN R208). The API answers a fault as `unexpected`, never with its message, reports it
  once, by its code, and answers an unknown route under `/api` with its own headers. The error relays refuse what a
  browser marks as sent from any other origin, and the admin's chart can limit its relay per address, as the web chart
  does. The share images take fflate 0.7.5, which fixes an advisory in code they never call. The migrations image is
  unchanged, rebuilt only because the shared lockfile changed.

## 0.7.2

### Patch Changes

- 1ffae74: Dependencies bmp
- Updated dependencies [1ffae74]
  - @aiontheballot/domain@0.14.1
  - @aiontheballot/ui@0.4.4

## 0.7.1

### Patch Changes

- Updated dependencies [83137c3]
  - @aiontheballot/domain@0.14.0
  - @aiontheballot/ui@0.4.3

## 0.7.0

### Minor Changes

- 77f1e8f: Sharing, data first: one "Compartir" panel under each election page's title, the data image first (square, portrait
  or story; to the phone's apps or downloaded) and the link second. The election page's link preview now shows every
  party's rating on every criterion, and the party, criterion and whole-table cards are redrawn in the same style; every
  data card carries its data's date and the site's address, with no totals and no ranking (PLAN R185).

## 0.6.0

### Minor Changes

- 362ae1e: A party shows as its logo, without a frame, in a box of one size, or else as a rounded square of its colour, with
  its colour as a thin line under its name (under the logo beside a link, so it never reads as a second underline):
  on the site, its share images and the admin's party list, in place of the colour square (PLAN R184).

## 0.5.3

### Patch Changes

- Updated dependencies [f5ab992]
  - @aiontheballot/domain@0.13.0
  - @aiontheballot/ui@0.4.2

## 0.5.2

### Patch Changes

- Updated dependencies [d7e62ac]
  - @aiontheballot/domain@0.12.0
  - @aiontheballot/ui@0.4.1

## 0.5.1

### Patch Changes

- 1578588: A party without a colour leaves a blank space beside its name instead of an empty square; a password link written
  just after an authenticator reset is forgotten rather than mailed (PLAN R180).

## 0.5.0

### Minor Changes

- 3854bad: Country admins choose their site's colour in Settings, and the public site and its share images take it, with the
  text that reads on it; parties' colours show beside their names on the share images (PLAN R178).

### Patch Changes

- Updated dependencies [3d17625]
- Updated dependencies [3854bad]
  - @aiontheballot/domain@0.11.0
  - @aiontheballot/ui@0.4.0

## 0.4.0

### Minor Changes

- 6efba86: The scorecard's link preview invites to the page, with the parties' logos and no ratings (PLAN R176), and every
  election page offers share links under its title: WhatsApp, Telegram, X, Facebook, Bluesky, LinkedIn, email, the
  device's share sheet and copying the link (R177).

### Patch Changes

- 65392f7: The share-card invariants test allows a slow runner the time the reference test does; nothing drawn changes.

## 0.3.14

### Patch Changes

- Updated dependencies [0cc4860]
  - @aiontheballot/domain@0.10.4
  - @aiontheballot/ui@0.3.0

## 0.3.13

### Patch Changes

- 483ae64: The whole-table image draws each party's logo beside its name, as the other cards do (PLAN R173).

## 0.3.12

### Patch Changes

- 7c90561: The table image (PLAN R164) shows every column's header, also when it stands on end next to a narrow party column,
  and its rows and icons grow when there are few parties.

## 0.3.11

### Patch Changes

- dd99189: The whole table as one image (PLAN R162): the scorecard's download dialog offers every party's rating on every
  criterion in the square, portrait and story sizes, drawn by a new share-card template.

## 0.3.10

### Patch Changes

- Updated dependencies [7083260]
  - @aiontheballot/domain@0.10.3
  - @aiontheballot/ui@0.3.0

## 0.3.9

### Patch Changes

- Updated dependencies [9224479]
  - @aiontheballot/domain@0.10.2
  - @aiontheballot/ui@0.3.0

## 0.3.8

### Patch Changes

- Updated dependencies [3ba6bb4]
  - @aiontheballot/domain@0.10.1
  - @aiontheballot/ui@0.3.0

## 0.3.7

### Patch Changes

- 3590ae1: Share images for every election page (PLAN R148): the scorecard, parties, criteria, cells and the methodology each
  have their own card, link preview and four-size download, drawn from a theme passed in; changed views' previews are
  pre-rendered when the web app's copy of an election changes.

## 0.3.6

### Patch Changes

- b83859e: Share images follow their pictures by themselves (PLAN R147): each template's build-time fingerprint, from probe
  renders, is folded into its images' hashes, replacing TEMPLATE_VERSION and the pinned SVG; a reference test compares
  the probes with committed pictures, with old, new and diff kept by CI, and `pnpm cards:accept` takes a change.

## 0.3.5

### Patch Changes

- a8ed7d2: Dependencies bump

## 0.3.4

### Patch Changes

- 4516915: Party logos (PLAN R142): uploaded on a party's admin page while its election is a draft (PNG, JPEG or WebP, up to 2 MB
  and 4,096 pixels a side, checked by its own header), and shown beside the party's name on the public pages.
- Updated dependencies [bf4876f]
- Updated dependencies [4516915]
  - @aiontheballot/domain@0.10.0
  - @aiontheballot/ui@0.3.0

## 0.3.3

### Patch Changes

- Updated dependencies [b869a83]
  - @aiontheballot/ui@0.3.0

## 0.3.2

### Patch Changes

- 464c259: satori 0.41.0, which draws the share images exactly as 0.38.2 did (their pinned SVG is unchanged).

## 0.3.1

### Patch Changes

- 7ba5873: Dependencies bump
- Updated dependencies [7ba5873]
  - @aiontheballot/ui@0.2.1

## 0.3.0

### Minor Changes

- 7f83fd8: Site icons: the platform's default (the coming-soon ballot, marked with the AI sparkle, on an orange tile), or a
  tenant's own square PNG from its new `site_icon` logo slot (a whole PNG, 512 to 1,024 px). Pages name the icons by
  content hash at `/brand/icon/{size}.{hash}.png`, cached as immutable, with `/favicon.ico` and a web manifest. The
  seeds give `ejemplo-a` a fictional icon.

## 0.2.0

### Minor Changes

- 1f4eabe: Tenants' own logos (migration `tenant_brand_uploads`): a brand selection can name one of the tenant's uploaded
  images, public while an active tenant selects it. The API serves the home data's brand images by hash; the web app
  shows the operator's logo in the coming-soon page's header and footer, at `/brand/{sha256}.{ext}` cached as immutable,
  and draws it on the share cards.

## 0.1.0

### Minor Changes

- 0bcb112: Link previews for the coming-soon page: Open Graph and Twitter tags, the canonical address and `hreflang` from the
  routing table, and share images in the four sizes from the new `packages/og` (satori, then resvg, fonts embedded),
  served from content-hash URLs cached as immutable, with 304s. Images are pre-rendered while their page renders and
  when a server starts. The hero's name is sized by the viewport's height too.
