-- migrate:up

-- A source's copy of up to 100 MB (PLAN R229): a party's programme of 69 MB, mostly images, didn't fit the 50 MB a file
-- could be. The table's check is the ceiling of every file; the API keeps each upload to its own, smaller where it
-- was (an attestation's file 50 MB, a brand image 2 MB by its own trigger), and a fetched copy stays at 50 MB.

ALTER TABLE app.files DROP CONSTRAINT files_byte_size_check;
ALTER TABLE app.files ADD CONSTRAINT files_byte_size_check CHECK (byte_size >= 0 AND byte_size <= 104857600);

-- migrate:down
-- Forward-only: migrations are never rolled back. Recover by restoring a backup (ADR-0001).
