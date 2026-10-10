# ADR-0004: File bytes on a volume

- **Status:** Proposed. The move itself is the owner's decision (PLAN R61); the details below are for review.
- **Date:** 2026-10-10
- **Deciders:** Dani (moving the bytes out of Postgres); the design, proposed by Claude
- **Relates to:** BRIEF §2 (RLS "including storage buckets"), §8 (isolation matrix);
  [ADR-0001](0001-hosting-and-delivery.md) (files, backups); [ADR-0002](0002-tenancy-and-authorization.md) (§5
  storage, §11 data rules, T9)

## Context

Until migration `files_on_volume`, stored files' bytes lived in Postgres: `app.file_blobs` (bytea) for tenants'
uploads and `brand_assets.content` for the platform's brand images. A trigger, `private.blob_matches_file()`, refused
bytes whose SHA-256 or size didn't match their `app.files` row, so "a stored file is what its hash says" was a
database rule, like the other data rules (CLAUDE.md: data rules are database triggers).

The owner decided to keep the bytes out of Postgres, before any were stored (PLAN R61). Facts that bear on it:

- **Dumps.** The cluster's backup plan dumps every database nightly and keeps the last 14 dumps; it already flagged
  `aiontheballot`, with up to 2 GB of programme PDFs (ADR-0001's cap), as the largest one.
- **No object storage** runs in the cluster (ADR-0001, gaps). What it has is `local-path`: a folder on the single
  node. In this cluster the storage class's `defaultVolumeType` is `local`, so its volumes are `local` persistent
  volumes, not `hostPath` ones (checked with `kubectl get storageclass local-path -o yaml`).
- **Backups.** The backup plan copies volumes with Velero's file-system backup (kopia), which supports `local`
  volumes and not `hostPath` ones. A volume's type is fixed when it is created.
- **Hashes are not secrets.** `aiontheballot_web` reads `source_documents.sha256` (the public hash of our stored copy,
  BRIEF §3), and any role that can write an `app.files` row chooses the hash it records.
- **Moving a data rule out of the database** changes the security model, so it needs this ADR (CLAUDE.md).

## Options considered

| Criterion                 | A. Bytes in Postgres (before)     | B. Bytes on a `local-path` volume (chosen) | C. Object storage (S3, MinIO)        |
| ------------------------- | --------------------------------- | ------------------------------------------ | ------------------------------------ |
| Hash and size checked by  | A trigger, for every writer       | The file store, on write and on read       | The file store, on write and on read |
| Isolation of bytes        | RLS on `file_blobs`               | RLS on the row, then the row's own folder  | RLS on the row, then the row's key   |
| Backups                   | In the nightly dump (large dumps) | A volume copy, after the dump              | The bucket's own copies              |
| Runs on the cluster today | Yes                               | Yes                                        | No: nothing to run it on yet         |
| Size limit                | 2 GB in total (ADR-0001)          | The node's disk                            | The bucket's                         |
| More than one node        | Yes                               | No: a second node needs shared storage     | Yes                                  |

C is where B goes if the platform outgrows one node: the store is an interface (`FileStore`), so a bucket can replace
the folder without touching callers.

## Decision

### 1. Rows and rules in Postgres, bytes on the volume

- `app.files` (tenant, bucket, type, size, hash) and `app.brand_assets` keep their rows, and with them every rule:
  RLS decides who sees a file, grants decide who writes one, and a file never changes (no `UPDATE`; `DELETE` only
  while nothing references it).
- The API reads bytes only for a row it can see, through `packages/db`'s file store. The volume is mounted by the API
  at `/data`, read-write (`put-file` runs in its pods); the store's root is `FILES_ROOT=/data/files`.
- Whether the worker mounts it too, once it exists, is left open: it parses hostile documents (threat A8), and its RLS
  today limits it to the one file of its job. A read-only mount, or the bytes handed over by the API, would keep that
  limit (PLAN, D8).

### 2. Each row reaches only its own space

Bytes live at `{root}/{space}/sha256/ab/cd/{sha256}`, where the space is:

- `{tenant_id}/{bucket}` for a tenant's file (`public_assets` or `sources`), from its `app.files` row;
- `platform` for a brand asset.

The API takes the space from the row it read, never from the request, and the same bytes are stored once per space.
Without spaces, a member of tenant B could record an image whose hash is tenant A's private programme, select it as a
logo, and have the public brand route serve A's bytes. With them, that row points at B's own `public_assets` folder,
where those bytes don't exist: the route answers 404. Within a tenant, a public image can't reach a source's bytes
either. The API's database tests run this attack against the real schema.

### 3. The integrity rule moves into the store

`private.blob_matches_file()` is gone with `file_blobs`. In its place, the file store:

- **computes the hash itself:** `put(space, bytes)` returns it, and that is what the row records. Callers never supply
  a hash for bytes they store;
- **writes atomically:** a temporary file on the same volume, flushed (`fsync`), renamed into place, then the folder
  flushed, so a reader never sees half a file and a crash leaves only a temporary file behind. Temporary files older
  than a day are deleted when the API starts;
- **trusts an existing copy only if it checks out:** if the bytes are already there with the right size and hash, the
  write is skipped; a copy cut short or damaged is replaced;
- **checks every read:** bytes whose hash doesn't match the one asked for are never returned (the read throws, which
  GlitchTip reports).

So bytes that don't match their row are never stored and never served, but the rule now lives in TypeScript and is
proven by unit tests (`packages/db/src/file-store.spec.ts`), not by a database test. What the database can no longer
prove is that a row's bytes exist at all: a row whose bytes are missing is served as 404, never as other content.

### 4. Bytes before rows

A row never names bytes that aren't stored yet. Until the admin can upload (M2), `node dist/put-file.js` stores bytes
from standard input and prints their hash, and an owner's SQL script writes the rows. M2's upload route inserts the
row first inside its `withActor` transaction, so RLS refuses a writer before any byte is written; it then stores the
bytes, and commits only once they are on the disk. A failed commit leaves bytes no row names, which the sweep removes.

### 5. Purge and sweep

- **Purge.** `private.purge_tenant()` deletes the tenant's rows; then `purge-tenant-files`, run in an API pod as
  `node dist/purge-tenant-files.js <tenant-id> --delete`, deletes the tenant's folder. It acts only on proof read from
  standard input: the owner's query prints `purged <tenant-id>` only for a tenant that `purge_log` records and that no
  longer exists, so a mistyped id, or an inactive tenant that still exists, deletes nothing. Without `--delete` it only
  says what it would delete. It never runs during a sweep (it takes the sweep's lock), and it also deletes whatever of
  the tenant a halted sweep left set aside.
- **Sweep.** Bytes that no row names are deleted only after no row has named them for a **grace period at least as
  long as the oldest database backup that could be restored**, so restoring an older dump never finds its bytes gone.
  With the backup plan's numbers (weekly Velero backups kept 90 days, each holding the last 14 nightly dumps, plus a
  week for backups that expire late) that is 111 days; the sweep refuses less, and defaults to 120. If the plan keeps
  backups longer, the minimum (`MIN_GRACE_DAYS`) must grow with it.
- **How the sweep knows since when.** A file's dates say when it was written, not when its row went away. The audit
  log keeps the old values of every deleted file row and of every brand asset whose hash changed, so the owner's list
  gives the last time a row stopped naming each file; a ledger on the volume adds when the sweep first saw a file
  unnamed, for bytes no row ever named (an upload whose transaction failed). The later of the two counts, so a file
  named again and dropped again waits its full time again. A purge removes its tenant's audit rows, and its bytes
  with them. A database restore rewinds the log, forgetting rows named and dropped after the dump, so no clock can be
  trusted after one. The list carries the database's identity (the cluster, its timeline, the database's and the
  audit table's OIDs: a logical restore recreates the tables, a physical one starts a new timeline) and the log's
  sequence; when the identity changes or the sequence goes down, the sweep starts every clock again, keeps that, and
  deletes nothing that run, `--delete` or not. A restore that changed neither would go unseen, so the restore
  procedure also deletes the ledger (`sweep-ledger.json`), which has the same effect.
- **How it runs.** No runtime role can list every tenant's files, so the owner pipes the list from Postgres, as
  `postgres` with row security off, into `sweep-files` in an API pod (`--print-query` prints the query). The command
  refuses a list that doesn't end with its own count, a list that names nothing while files are stored, and one that
  names files the volume lacks (another database, or a wrong volume); it deletes more than half the stored files only
  with `--allow-many`; one sweep runs at a time (a lock file). Without `--delete` it records and reports. A file stored
  or reused within a day of the list's snapshot is never deleted: `put` marks reused bytes as just written, and the
  sweep moves a file aside (to `retired/`, which the API's temporary cleanup never touches) and checks it there before
  deleting it, so an upload of the same bytes at that moment gets them back; putting a file back never replaces a fresh
  copy (`link`, not `rename`), and nothing is moved through a link. A sweep stopped halfway leaves its lock, which
  someone must delete by hand once sure no sweep runs; until the next sweep puts them back, the files it had set aside
  are missing (named ones answer 404), so that is done promptly. The list also says whether it saw every row; one taken
  with row security on is refused. Rows written by hand after `put-file` should follow within the day. Running it on a
  schedule needs a role that can read that list: a new grant, so an ADR-0002 decision (PLAN, D7).

### 6. The volume

- `storageClass: local-path`, with the PVC annotated `volumeType: local`, so the volume is a `local` volume whatever
  the class's default becomes. This is decided before the first deploy, because the provisioner reads it only once.
- `ReadWriteOnce`: on one node, every API replica mounts it.
- The provisioner creates the folder as `root:2000`, mode 0770. The pods run as uid 1000 with `fsGroup: 1000`, which
  the kubelet applies to `local` volumes (other uid-1000 pods on the cluster, such as Headscale's, write to theirs
  this way); `fsGroupChangePolicy: OnRootMismatch` sets it once rather than walking every file at each start. At
  startup the API writes, flushes and deletes a probe file and logs whether the store is writable.
- **Size:** `local-path` neither enforces nor expands the size the claim asks for. The volume can grow until the
  node's disk is full, so disk usage is what to watch.
- The claim is kept when the release is uninstalled and is never pruned or deleted by Argo CD, and the cluster's
  `local-path` class reclaims with `Retain` (checked with `kubectl get storageclass local-path`), so even deleting the
  claim by hand leaves the folder on the node.

### 7. Backups

- The volume is to be copied by Velero's file-system backup, as part of the cluster's backup plan (gitops), which
  isn't running yet: until it is, the volume, like the database, has no off-node copy.
- **Each volume copy is taken after the database dump it goes with.** Rows are written after their bytes, so every row
  in a dump names bytes already on the volume when the dump was taken; a copy taken after the dump contains them,
  because the sweep deletes nothing a row named less than the grace period ago (§5) and purges are deliberate.
- **Restoring:** a dump and the volume copy taken after it restore together. Restoring only the database from an
  older dump onto the live volume works too, within the grace period; after any restore the sweep's ledger is
  deleted too, and the next sweep would also see the database changed (§5). The preview's restore check covers both.
- A purge deletes a tenant's bytes at once; copies in older backups expire with them, as for the database.

### 8. Locally and in tests

The seeds and the end-to-end tests use `.data/files` in the repository unless `FILES_ROOT` says otherwise: `pnpm
db:seed` writes the seeds' bytes there (again on every run, so a lost folder comes back) and the end-to-end API reads
them. The API itself has no default: without `FILES_ROOT`, its brand-image route answers 503.

## Consequences

**Benefits:**

- Database dumps stay small, and the 2 GB cap on all files together is gone (50 MB per file and 2 MB per brand image
  stay). Nothing caps a tenant's total any more; M2's uploads should add a per-tenant quota (a sum over its rows).
- Bytes are read from disk, not through Postgres.

**Costs and risks:**

- **One more thing to back up, in order.** A volume copy taken before the dump can miss bytes that the dump's rows
  name.
- **A data rule left the database.** The file store is now the only check that bytes are what their row says. A
  compromised API could already write any row it wanted (T23); what it can't do is make the public routes serve bytes
  from another tenant's or another bucket's space.
- **Every API pod can read and write every tenant's bytes,** private sources included, where before it reached them
  only through RLS. A compromised API could already read them by impersonating members (T23), so this widens nothing
  for A10; it does mean a bug in the API's file code, not RLS, is what would leak bytes, which is why the API takes
  the folder only from the row it read, and why the worker's access is left open (§1).
- **Large files and memory.** `put-file` holds a whole file in memory inside the API container's limit (384 MiB):
  fine for logos, but M2's uploads should stream.
- **Orphaned bytes** stay on the volume until the sweep's grace period ends.
- **One node.** A second node needs shared (`ReadWriteMany`) storage or object storage behind the same interface.

**Revisit** when the cluster gets a second node or object storage, or if the volume approaches the node's free disk.
