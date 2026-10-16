# ADR-0006: Extraction jobs reach the worker over HTTP

- **Status:** Accepted (PLAN D12, answered by Dani: option B, on condition it follows best practice). Supersedes
  ADR-0003's default for the job queue (pg-boss) and the data model's §8 on it.
- **Date:** 2026-10-12
- **Deciders:** Dani; drafted by Claude
- **Relates to:** BRIEF §5 (ingesting programmes), §8 (least privilege, observability);
  [ADR-0002](0002-tenancy-and-authorization.md) (§2 roles, the worker's job scope);
  [ADR-0003](0003-application-stack.md) (§1 the worker, guardrail 1; Still open: job queue);
  [ADR-0004](0004-file-bytes-on-a-volume.md) (the API alone mounts the file volume); PLAN R116, R133, R139, R146

## Context

- **What the worker does.** It extracts the text of sources' stored copies, which are a party's documents and so
  hostile, in a box (R116, R133): no file volume, no secret beyond its own database login, one copy at a time, each
  parsed in a child process with a memory limit and a deadline. The API, which alone mounts the volume (ADR-0004),
  hands it the bytes of the job's copy; the worker uses them only if their SHA-256 is the one the source recorded, and
  writes as `aiontheballot_worker`, whose RLS shows only the open job it names (ADR-0002).
- **What ADR-0003 assumed.** A Postgres-backed queue (pg-boss): the API enqueues the job's id, the worker takes it.
  With R116 the worker can't read the bytes itself, so with a queue it would have to ask the API for them: a new
  internal route authenticated by the network and the job's id, plus grants on pg-boss's schema for two roles (an
  ADR-0002 change). pg-boss was never installed.
- **What R133 built.** After the upload commits, the API posts the job's id and bytes to the worker, which answers once
  the job is finished. No new grant, route or schema; but a job missed while the worker was away waited until someone
  pressed "Ask for the text again", and a failure reached nobody unless the API reported it.
- **What must hold.** A job is never lost for good, with no new permission: no runtime role may list open jobs across
  tenants (the owner would have to grant one, an ADR-0002 change; Dani asked not to). Retries must not pile up on a
  worker that is restarting. Only the API may hand the worker a job. Someone hears about a job that waits too long.
- **Facts checked (2026-10-12).** The charts' policies need a CNI that enforces Kubernetes NetworkPolicy; Cilium
  does, after a Service's translation (so a policy names the pods' port). The worker's policy allowed it only the
  database and DNS, so its error reports couldn't reach the error tracker its DSN names.

## Options considered

| Criterion                      | A. pg-boss queue                                        | B. HTTP handover, hardened                                       | C. Worker polls `job_requests`           |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| New permissions                | pg-boss's schema for API and worker; an internal route  | None                                                             | A cross-tenant read of open jobs (owner) |
| How the bytes reach the worker | The worker asks the API's new route                     | The API streams them with the job                                | The worker asks the API's new route      |
| A job the worker missed        | Kept in the queue                                       | Retried by the API, then redelivered when its sources are listed | Found on the next poll                   |
| Moving parts                   | A library, its schema and migrations, a second door     | One door, one secret                                             | A loop, a second door                    |
| Fits the worker's box (R116)   | Reaches the API as a client: a credential in the worker | Yes: the worker only answers                                     | Same as A                                |
| Back-pressure                  | Queue depth                                             | The worker's own queue (10 waiting, then 503) and retry          | Poll rate                                |

**A** is the textbook queue, but it needs the worker to fetch bytes from the API (a credential in the box, a route
that serves any job's copy to whoever presents it) and grants on a library's schema. **C** needs a role that reads
every tenant's open jobs, which is the permission Dani asked not to add. **B** keeps the worker a server that only
answers, and closes its gaps with the practices a queue would give: bounded retries with backoff and jitter, durable
redelivery, authentication beside the network policy, and an alert.

## Decision

**The worker is a service the API calls (B).** ADR-0003's job-queue default and the data model's pg-boss section are
superseded: there is no `pgboss` schema. `job_requests` stays the durable record of every job (data model §3.10).

1. **Handover.** After the job's transaction commits, the API streams the copy to `POST /jobs/{id}` on the worker's
   Service, with `Authorization: Bearer <WORKER_TOKEN>`. The worker answers once the job is finished: 204 done, 404
   no such open job (already finished), 409 already here, 422 bytes that aren't the source's copy, 401 no secret, 503
   busy or unable to run a parser (the job stays open), 500 a fault it didn't expect (the job stays open). One
   replica sends a job once while it is on its way, and has at most 4 on their way at once (two replicas stay under
   the worker's 10 waiting), the rest waiting in the API, 100 at most. There is one worker pod, replaced by
   recreating it, never two at once: its queue and its refusal of a job it already has are its process's.
2. **Retries in the API, bounded, by what failed.**
   - **Transient** (nothing was parsed): no connection at all (refused, unreachable, a DNS failure, a connect
     timeout), 503, and 429, 502 or 504 from anything between. Tried again at once: six tries in all, waiting 2 s
     doubled each time up to 30 s, each wait half fixed and half random ("equal jitter"), so waits grow whatever the
     draw and replicas that failed together don't retry together: about a minute in all, which covers the worker
     restarting with its self-check. Then left for redelivery.
   - **Lost** (the connection went after the worker had the job): the worker may have restarted, or died on the
     document (a decompression bomb past its memory limit). Never tried again at once; left for redelivery, and after
     3 such losses this replica hands it over again only when someone asks, and reports it.
   - **Final**: 401 (a secret that isn't the worker's), 422, 500 (another try would parse the document again for
     the same fault), any other answer, a copy missing from the store or damaged as it streams, a request the worker
     held past its window. Reported at once; never handed over again by itself, only when someone uploads or asks
     for the text again, which starts afresh.
3. **Durable redelivery, with no new permission.** When a member lists an election's sources, or opens one source's
   page, the API reads that election's open extraction jobs in the same `withActor` transaction, as that member, so
   RLS shows only their sites' jobs (members already read their tenant's `job_requests`). After the transaction, each
   job open for 5 minutes or more is handed over again, unless this replica has it on its way, tried it within the last
   5 minutes (another replica's handover may still be waiting in the worker's queue; the worker then refuses it with
   409), or has given up on it (2). The job keeps its requester: the worker writes in their name (W11), whoever
   listed. Accepted: a job is redelivered only once someone looks at its sources, which is when its text is wanted.
4. **A shared secret, beside the NetworkPolicy.** The NetworkPolicy lets only the API's pods reach the worker, and
   the CNI enforces it; as defence in depth, the worker refuses (401) a job without `WORKER_TOKEN` before it looks at
   the job, so the answer says nothing about it, compared in constant time (both sides hashed with SHA-256, then
   `timingSafeEqual`); of a refused request's body, at most 1 MB is read and dropped before the connection closes.
   Both refuse to start without it (32 printable ASCII characters or more, no spaces), and the API also without its
   address, or the address without it. It is a SealedSecret in gitops (`scripts/seal-worker-token-secret.sh`), never
   logged; error reports keep no request header but the user agent. `GET /healthz` stays open, for the kubelet.
5. **Reports.** Jobs still open an hour after they were requested (twice the longest a handed-over job can take) are
   reported to error tracking by the API when a listing finds them: together, at most every half hour per replica, with
   how many, the oldest's wait and up to five ids, so a backlog is one report. The worker reports its own faults (a
   parser that can't start, a database error, a failed self-check at startup) by their class only (a SQLSTATE and
   routine, an error's name), never a message, which could quote the document. Its NetworkPolicy gets an egress rule
   to the error tracker (`worker.networkPolicy.errorTracking`, set in gitops); its DSN comes from its own `envFrom`,
   never from the API's environment, which holds other roles' credentials.

## Consequences

- **Easier:** no queue library, schema or grant; the worker holds no credential to the API and serves only the API;
  a job's whole life is in `job_requests`, which members already see and the audit log records.
- **Harder:** delivery is the API's job, so its rules (retries, redelivery) live in `extraction-dispatch.ts` and its
  tests, not in a library. A job nobody lists waits; the hour's report needs a listing too.
- **Risks accepted:** two replicas can each hand over the same job: the worker takes it once and refuses the other
  (409), at the cost of at most 1 MB of the refused upload read and dropped. A document that kills the worker can do
  so up to 3 times per API replica before it waits for a person; each time, the jobs waiting in the worker's queue
  lose it too and count a loss, so after such a crash loop some may wait for someone to ask again (the hour's report
  says so). A secret shared by two pods is one more secret to rotate (reseal, then restart both).
- **Revisit when:** other job kinds arrive (fetching by URL, D13; LLM runs, M4), or many sources at once make
  redelivery on listing too slow: a role that lists open jobs (an ADR-0002 change) or a queue becomes worth its
  permissions then.
