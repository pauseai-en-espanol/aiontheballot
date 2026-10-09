---
'@aiontheballot/migrations': minor
---

Add stored files: `app.files` (metadata) and `app.file_blobs` (bytes) under the same RLS. Bytes must match the
file's SHA-256 and size; nothing is ever updated; a file is deleted only while unreferenced, with its bytes. Editors
and country admins upload and delete; members read. The original filename is personal data.
