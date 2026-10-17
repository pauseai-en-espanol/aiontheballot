---
'@aiontheballot/web': patch
---

The site keeps serving while the API or its database is slow: the health probe no longer waits for the routing
table, and a table past its age is served at once while a fresh one loads.
