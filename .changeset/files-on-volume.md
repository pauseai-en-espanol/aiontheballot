---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
'@aiontheballot/api': minor
'@aiontheballot/e2e': minor
'@aiontheballot/web': patch
'@aiontheballot/admin': patch
---

File bytes move from Postgres to a persistent volume (migration `files_on_volume`, ADR-0004): the API mounts a
`local-path` volume of type `local` at `/data` and reads each file's bytes from its row's own tenant and bucket, only
for a row RLS shows, checking the hash on every read. `file_blobs` and the brand assets' inline bytes are gone; the
migration refuses to run while any bytes are stored in the database. `node dist/put-file.js <tenant-id> <bucket>`
puts bytes on the volume from stdin until the admin can upload them, and `node dist/purge-tenant-files.js` deletes a
purged tenant's folder, given proof of the purge. Web and admin are rebuilt only because turbo.json changed.
