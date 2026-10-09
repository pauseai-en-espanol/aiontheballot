---
'@aiontheballot/migrations': minor
'@aiontheballot/db': minor
---

Add job requests and the worker's access. The worker sets `app.job_request_id` and acts as the request's requester;
its RLS shows only that open request and what it names (its tenant, source, the source's copy and pages, its LLM run
and the run's election), a trigger limits what each job kind may change, and finishing the request ends what it
authorizes. Requests are made only when their job has something to do, and change only by finishing, once.
