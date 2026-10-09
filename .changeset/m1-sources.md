---
'@aiontheballot/migrations': minor
---

Add source documents and their extracted text. A source's stored copy (a sources-bucket file) is set once, with its
hash and time from the file and the session; after that only its extraction status (one way) and archive URL (once)
change. Extracted text is private, added only while the source is pending, and never changed. Editors and country
admins add and edit sources until their copy is stored; members read them.
