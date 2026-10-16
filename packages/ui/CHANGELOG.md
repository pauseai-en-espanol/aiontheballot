# @aiontheballot/ui

## 0.4.4

### Patch Changes

- 1ffae74: Dependencies bmp
- Updated dependencies [1ffae74]
  - @aiontheballot/domain@0.14.1

## 0.4.3

### Patch Changes

- Updated dependencies [83137c3]
  - @aiontheballot/domain@0.14.0

## 0.4.2

### Patch Changes

- Updated dependencies [f5ab992]
  - @aiontheballot/domain@0.13.0

## 0.4.1

### Patch Changes

- Updated dependencies [d7e62ac]
  - @aiontheballot/domain@0.12.0

## 0.4.0

### Minor Changes

- 3854bad: Country admins choose their site's colour in Settings, and the public site and its share images take it, with the
  text that reads on it; parties' colours show beside their names on the share images (PLAN R178).

### Patch Changes

- 3d17625: A site's own colour keeps focus rings, borders and the coming-soon page's button visible on it, the public site
  checks a site's colours again as it loads them, and the colour form's reset and contrast ratio read right (PLAN R178).
- Updated dependencies [3d17625]
- Updated dependencies [3854bad]
  - @aiontheballot/domain@0.11.0

## 0.3.0

### Minor Changes

- b869a83: The public site's election pages (PLAN R125): the scorecard, with a table on desktops and cards per party or per
  criterion on phones, and the party, criterion, cell and methodology pages, every cell able to show "pending", from a
  new public election route in the API. The fixed rating visuals. Security headers on every response (R126); per-site
  sitemaps and robots, and the page's language in `<html lang>` (R127).

## 0.2.1

### Patch Changes

- 7ba5873: Dependencies bump

## 0.2.0

### Minor Changes

- 2f43760: A tenant's home is now its coming-soon page, in PauseAI's brand: the tenant's name, what the site will do, the next
  public election and the operator's links, all from data, in Spanish and English, on a desktop and a phone. The API
  serves it at `GET /public/tenants/{slug}/home` (read as `aiontheballot_web`); the web app caches each tenant's copy
  and keeps it when the API fails. The shared preset gains the brand colours as semantic tokens, contrast-tested, and
  the self-hosted fonts. The e2e suite checks the page with axe at both sizes.

## 0.1.0

### Minor Changes

- 85ada24: Add the shared Panda preset (@aiontheballot/ui) and the public and admin Next.js skeletons: a translated placeholder page,
  an unlogged /healthz, zoom left enabled, and no cookies or X-Powered-By on the public app. Add the "coming soon"
  message. Build packages without composite/incremental output so a JSON-only change can never leave stale
  declarations.

### Patch Changes

- e13c986: Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
  and the i18n JSON include they required, and write the Vitest configs in TypeScript.
- ff9135a: Build the UI package on install, so the web and admin Panda codegen can load its preset on a clean checkout. CI's first
  run failed at `pnpm install` because `dist/` did not exist yet.
