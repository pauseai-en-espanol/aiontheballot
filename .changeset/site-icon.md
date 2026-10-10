---
'@aiontheballot/og': minor
'@aiontheballot/domain': minor
'@aiontheballot/web': minor
'@aiontheballot/db': patch
'@aiontheballot/api': patch
'@aiontheballot/e2e': minor
---

Site icons: the platform's default (the coming-soon ballot, marked with the AI sparkle, on an orange tile), or a
tenant's own square PNG from its new `site_icon` logo slot (a whole PNG, 512 to 1,024 px). Pages name the icons by
content hash at `/brand/icon/{size}.{hash}.png`, cached as immutable, with `/favicon.ico` and a web manifest. The
seeds give `ejemplo-a` a fictional icon.
