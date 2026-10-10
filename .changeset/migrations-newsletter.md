---
'@aiontheballot/migrations': minor
---

Ship migration `organization_newsletter` (`organizations.newsletter_url`), which the coming-soon release needs: its
changeset bumped the API and web but not this package, so the migration image wasn't rebuilt and production's API
asked for a column that didn't exist yet.
