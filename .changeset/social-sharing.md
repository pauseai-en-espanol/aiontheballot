---
'@aiontheballot/og': minor
'@aiontheballot/web': minor
'@aiontheballot/api': minor
'@aiontheballot/domain': minor
'@aiontheballot/e2e': minor
---

Link previews for the coming-soon page: Open Graph and Twitter tags, the canonical address and `hreflang` from the
routing table, and share images in the four sizes from the new `packages/og` (satori, then resvg, fonts embedded),
served from content-hash URLs cached as immutable, with 304s. Images are pre-rendered while their page renders and
when a server starts. The hero's name is sized by the viewport's height too.
