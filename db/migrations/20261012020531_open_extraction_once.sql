-- migrate:up

-- A source has one extraction job open at most (PLAN R133): its upload requests it, and asking the worker again hands
-- over that same job rather than a new one. The API already refuses a second upload to a source with a copy, under a
-- lock on the source; this makes it the database's rule too, whatever writes the job. No source can have two open
-- jobs yet (nothing in production uploads copies before this release), so the index builds on what is there.

CREATE UNIQUE INDEX job_requests_one_open_extraction
  ON app.job_requests (source_document_id)
  WHERE kind = 'extract_source' AND finished_at IS NULL;

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
