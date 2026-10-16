# ADR-0007: Copies by URL and archive snapshots, through a fetcher

- **Status:** Accepted (PLAN D13, R166: Dani chose the recommendation, a third, smaller box that only fetches, on
  2026-10-13). Built in PLAN R175, off until gitops turns it on.
- **Date:** 2026-10-13
- **Deciders:** Dani; drafted by Claude
- **Relates to:** BRIEF §5 (ingesting programmes), §8 (least privilege); [ADR-0002](0002-tenancy-and-authorization.md)
  (§2 roles, the worker's job scope, threats A8 and T29); [ADR-0004](0004-file-bytes-on-a-volume.md) (the API alone
  mounts the file volume); [ADR-0006](0006-extraction-jobs-over-http.md) (the worker as a service the API calls);
  editorial workflow S2.1, S4, W11, W12 and O1; PLAN R116, R133, R167

## Context

- **What is missing.** Editors store a source's copy by uploading it (S2.2); storing it straight from its URL (S2.1)
  and archiving a snapshot of that URL (S4) need the internet. Until now editors downloaded a party's document and
  uploaded it, and no source has a snapshot.
- **Who may not fetch.** The worker parses hostile documents with a database login; R116 keeps it off the internet,
  so a document that took it over could reach nothing. The API holds every other credential (four database logins,
  the file volume, Better Auth's secret, the mail account), so a URL an editor types must not make it connect anywhere:
  a request it is tricked into sending (server-side request forgery, SSRF) could reach the database, the worker or the
  cluster's own services.
- **What the database already allows.** The data model planned both as worker jobs: `fetch_source` attaches a copy
  as `fetched`, which only the worker may write; `archive_source` sets `archive_url`, once, which only the worker may
  write, and only while such a job is open (`worker_job_scope`). Editors could already request an `archive_source`
  job for a source with a URL and no snapshot (`job_request_rules`; since R175, only once its copy is stored).
- **Four-eyes.** An uploaded copy counts its uploader as a contributor of every cell that cites it
  (`private.revision_contributors`, D17), so whoever chose the bytes can't also approve the cells resting on them. A
  fetched copy is chosen as much by whoever typed the URL.
- **The Internet Archive** (O1, answered: its Save Page Now). Checked 2026-10-13 in its
  [public API documentation](https://docs.google.com/document/d/1Nsv52MvSjbLb2PCpHlat0gkzw0EvtSgpKHu4mk0MnrA): `POST
/save` with `Accept: application/json` and the URL returns a `job_id`; `GET /save/status/{job_id}` answers
  `pending`, `success` (with the capture's `timestamp` and `original_url`) or `error` (with `status_ext`), kept about an
  hour. An archive.org account's S3 keys (`Authorization: LOW {key}:{secret}`) are "highly preferable": 7 captures a
  minute and 30,000 a day, against 3 and 200 without them. A capture takes from seconds to minutes.
- **The admin's gateway route** may keep Envoy's default 15-second request timeout, so a member's request can't
  count on waiting longer than that.

## Options considered

| Criterion                     | A. The worker fetches           | B. The API fetches            | C. A fetcher, the API storing its bytes         |
| ----------------------------- | ------------------------------- | ----------------------------- | ----------------------------------------------- |
| A hostile document's reach    | The internet, with a DB login   | Every credential and the disk | Nothing: it parses nothing, and holds no login  |
| An SSRF's reach               | The worker's database role      | Everything the API reaches    | The internet only (policy, and checked in code) |
| New credentials               | None                            | None                          | One shared secret (as the worker's)             |
| Four-eyes for a fetched copy  | A new rule for `fetched` copies | As an upload                  | As an upload: the requester counts              |
| New grant or definer function | None                            | None                          | None                                            |

**A** undoes R116, which is the worker's whole defence. **B** puts the most trusted process at the end of a URL an
editor types. **C** gives the one capability that needs the internet to a box that holds nothing worth taking.

## Decision

**C: the fetcher.** It is a third process from the API's image (`node dist/fetcher.js`, its own Deployment and
Service in the API chart, `fetcher.enabled`, off by default), smaller than the worker, with **no database login, no
volume and no service-account token**: its environment is its port, the secret it shares with the API, the archive's
address and keys, and its own error-tracking DSN.

1. **Two doors, for the API alone.** `POST /fetch` with `{ url }` answers with the bytes of what the URL serves, its
   type and the address it ended at; `POST /archive` with `{ url }` answers with a snapshot's address, or that the
   archive gave none. Both need `Authorization: Bearer <FETCHER_TOKEN>`, compared in constant time as the worker does
   (ADR-0006 §4), and its NetworkPolicy admits only the API's pods. `GET /healthz` stays open, for the kubelet.
2. **Only the public internet.** Its NetworkPolicy lets it reach DNS and, on ports 80 and 443, every address but the
   private, loopback, link-local, shared (CGNAT) and multicast ranges, IPv4 and IPv6. A policy can't see names, so the
   fetcher checks too: `http` or `https` only, no user name or password in the URL, port 80 or 443, and every address
   the name resolves to public, checked in the connection's own lookup, so the address checked is the one connected to
   (no DNS rebinding). It follows at most 5 redirects, each checked the same way, sends no cookie and no referrer,
   gives up after a deadline (8 seconds by default, 10 at most, under the admin route's 15), a compressed body
   included, which is counted once decoded, and past 50 MB (a copy's limit). The archive's address is configuration,
   not a member's input, so it is exempt from the address check only.
3. **A copy by URL (S2.1) is the requester's upload.** On a source with a URL and no copy, an editor, country admin
   or platform admin presses "Fetch a copy". The API checks what it checks before an upload (who may, the source,
   no copy yet), asks the fetcher, and streams the answer into the file store exactly as an upload: hashed on the way,
   capped, a type an upload may have (a PDF, a web page, plain text or an image; bytes declared only as bytes are
   taken by their first bytes, as a PDF or an image; the fetcher refuses any other type before sending them), stored
   as `uploaded` in the requester's name, if the source still names the URL that was fetched. So four-eyes counts them
   as a contributor of every cell that cites it (D17, R167), and extraction follows as after any upload. As for an
   upload, bytes the site stored before are the same file, whose first uploader four-eyes counts instead (PLAN D21).
   The `fetched` origin and the `fetch_source` job stay unused: the worker never fetches.
4. **Snapshots (S4) are archive jobs the worker records.** When a copy is stored for a source with a URL and no snapshot
   (W11), and when a member asks for one, the API requests an `archive_source` job in that transaction (one open at a
   time per source, a unique index). Only once the copy is stored (the job rules say so): until then the URL can change,
   and a snapshot of an earlier address, set once, would stay beside the source on the public site; after, the URL never
   changes. The admin says that the snapshot is public. After it commits, the API asks the fetcher to archive the URL,
   which asks Save Page Now and waits for its answer (up to 5 minutes), then hands the result to the worker's new door,
   `POST /archives/{job}` with `{ archiveUrl }` (or `null`): the worker, which already holds the only grant on
   `archive_url` and only for an open archive job, sets it in the requester's name if there is one and finishes the job;
   with none, the job is finished without it and the source offers to ask again. No new grant, role or definer function.
   The worker takes only an `https` address with no user name; the API only one under the archive's address
   (`ARCHIVE_URL`, `https://web.archive.org` by default), built from the capture's timestamp and original URL. A job
   whose handover was lost (a restart) is asked again when its sources are listed, after 15 minutes, as extraction jobs
   are (ADR-0006 §3). A missing snapshot stays a warning, never a block (W12).
5. **Limits.** A member may fetch 30 copies an hour and ask for 30 snapshots an hour. The fetcher fetches 2 URLs and
   archives 2 at once at most, answering 503 past that; the API asks it for one archive at a time per replica.
6. **Reports.** The fetcher reports its own faults by their class only, and its error tracking adds nothing to its
   requests (no trace headers) and keeps no breadcrumb of them (their URLs are members'). A site that answers with an
   error, a type no upload may have, or too much is the member's to hear, in the admin, never an error report. The
   fetcher refusing the API (its secret, its own fault) is reported by the API.
7. **Configuration.** The API: `FETCHER_URL` and `FETCHER_TOKEN` (both, or neither: then the buttons are not shown
   and the routes answer 503), and `ARCHIVE_URL`. The fetcher: `FETCHER_TOKEN`, `ARCHIVE_URL` and, optionally,
   `ARCHIVE_ACCESS_KEY` and `ARCHIVE_SECRET_KEY`. The token is a SealedSecret (`scripts/seal-fetcher-token-secret.sh`),
   never logged.

## Consequences

- **Easier:** sources come straight from their URL, with a snapshot beside the copy, and nothing new can write the
  database: the fetcher has no login, and the worker's one new door writes what its existing grant already allowed.
- **Harder:** a third process to run and watch, and a second secret shared with the API. A slow site can't be
  fetched within the admin's 15 seconds: its document is uploaded by hand, as before.
- **Risks accepted:** the fetcher can be made to request any public address, with the cluster's egress address, as
  any browser could; it sends nothing but the URL's own request. A party site may serve the fetcher something other
  than what a browser sees (a different page by user agent); the copy is still the requester's to check, and four-eyes
  counts them for it. Without archive keys, Save Page Now may refuse captures (200 a day, 3 a minute); then sources
  have no snapshot until asked again. Two API replicas may each ask for the same waiting job's snapshot after a
  restart, a duplicate capture. A page's encoding is read from its own bytes, as an upload's is: one declared only in
  the HTTP header (and neither UTF-8 nor windows-1252) is decoded wrongly. A fetcher taken over could choose which
  capture under the archive's address a source gets; it can't reach the database or choose another address.
- **Revisit when:** sites need a real browser to serve their documents (a headless browser in the fetcher would need
  far more memory and sandboxing), or snapshots should come from more than one archive (O1's alternatives).
