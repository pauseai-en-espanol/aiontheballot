---
'@aiontheballot/domain': minor
'@aiontheballot/web': patch
'@aiontheballot/api': patch
---

The cell editor's live quote match (editorial workflow C2.6, W13): `matchQuote` in `packages/domain` says whether a
quote matches its source verbatim and on which pages, exactly as the database will, how much of it does if not, or
that it is too short or too long to save.
