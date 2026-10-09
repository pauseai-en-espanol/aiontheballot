---
'@aiontheballot/migrations': minor
---

Add the column conventions of the data model (spec §1): the domains `app.localized`, `app.slug` and `app.locale`,
checked with built-in functions only, and `private.stamp()`, which sets actor columns and event timestamps from the
session. A catalog test fails if any table leaves one of those columns unstamped.
