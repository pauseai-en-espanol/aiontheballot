---
'@aiontheballot/api': patch
'@aiontheballot/admin': patch
'@aiontheballot/web': patch
'@aiontheballot/migrations': patch
---

CI passes the sign-in tests' database URLs through Turbo (TEST_ADMIN_DATABASE_URL for the API's database tests; the
auth, admin and owner URLs for the end-to-end tests), which locally came from .env.
