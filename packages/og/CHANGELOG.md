# @aiontheballot/og

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
