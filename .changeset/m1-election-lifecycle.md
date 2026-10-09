---
'@aiontheballot/migrations': minor
---

Add the election lifecycle: draft → live → archived, never back. Going live needs an active tenant with its operator,
a methodology and default-locale texts, and stamps `went_live_at`; slugs, type and territory are fixed once live;
archived elections and their structure are read-only. Territories stay inside the tenant's country, methodologies use
the tenant's kind and a demands owner it links to, and a tenant's kind and country are fixed by the data that uses them.
