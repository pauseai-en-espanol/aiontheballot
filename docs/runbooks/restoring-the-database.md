# Restoring the database

The operator restores `aiontheballot` from a dump: as a drill into a scratch database (the preview gate and the
quarterly drill), or for real, when data is lost or damaged. The stored files' bytes live on a volume, not in the
dump (ADR-0004), and the orphan sweep keeps a ledger that a restore makes wrong (§6).

The backups themselves (what is copied, when, how long it is kept and where) are the cluster's backup plan, in gitops
(PLAN D2); §1 says what a restore needs from it. Before relying on this runbook, check in gitops that the plan's
dumps exist and are recent. The launch checklist requires one drill before launch.

SQL and `pg_restore` run in the Postgres pod's shell, as the superuser:

```sh
kubectl --context "$KUBE_CONTEXT" -n "$DATABASE_NAMESPACE" exec -it "$DATABASE_POD" -c postgres -- sh
export PGPASSWORD="$POSTGRES_PASSWORD"   # then psql -X -U postgres -d <database>
```

## 1. What a restore needs

- **A dump** of the database, taken with `pg_dump -Fc` as the superuser, and the roles' (`pg_dumpall --globals-only`),
  kept away from the database's own disk.
- **A copy of the file volume** (`aiontheballot-api-files`), taken after the dump. A dump and the volume copy taken
  **after** it restore together; restoring only the database onto the live volume works too, since the sweep keeps
  bytes no row names for longer than any backup is kept (120 days by default; never under 111).

## 2. What a restore rewinds

Everything written after the dump is gone or undone. Before a real restore, while the damaged database can still be
read, list what matters from it (§4 step 2). Access and personal data are put right by the operator in the restored
database **before it opens**, by id, since a removed member must not get back in even for minutes (the audit log
then names no actor for those rows); everything else is redone **through the admin**, so the audit log stays true.

| Written after the dump                                | After the restore                     | Put right by                                                                           |
| ----------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| Members and platform admins removed                   | Access back                           | The operator, before it opens (§4 step 4)                                              |
| Invitations revoked                                   | Usable again                          | The operator, before it opens                                                          |
| Signups unsubscribed                                  | Subscribed again                      | The operator, before it opens                                                          |
| Sessions signed out or revoked                        | Valid again                           | The operator deleting every session, before it opens: everyone signs in again          |
| A freeze window set                                   | Gone: publishing works again          | A country admin setting it again, **first**, before editors return                     |
| Reports anonymized on request                         | Personal data back                    | A country admin anonymizing them again, right after it opens                           |
| Published ratings, approved changes, programme status | Gone from the public site             | Editors republishing them, through review                                              |
| Site settings, policy texts, theme, hostnames         | Back to the dump's                    | The country admin or platform admin who changed them, again                            |
| Reports received                                      | Gone                                  | Nothing: they stay in the closed old database until it is dropped. Count them          |
| Password changes and resets                           | The old password works                | Telling those members to change it again; a compromise is [incidents](incidents.md) §5 |
| TOTP enrolments, backup codes used                    | Not enrolled; used codes valid again  | Members enrol again at sign-in; a lost device is incidents §5                          |
| Invitations accepted, accounts created                | Gone                                  | Invitations sent again                                                                 |
| Files uploaded                                        | Bytes on the volume, no row           | Editors uploading them again (the same bytes are reused)                               |
| A site purged                                         | The site back, with its personal data | The operator purging it again (data model §3), its files included                      |

The public site shows the restored data within a minute, without a restart: its copies are compared by content,
not by version. The API's pools survive the connections the swap ends (PLAN R153).

## 3. Drill: restore into a scratch database (operator)

1. Pick the dump and copy it into the Postgres pod, from wherever the backup plan keeps it (gitops). You should see a
   file of the expected size, from the expected time.
2. Create the scratch database and restore into it:

   ```sh
   psql -X -U postgres -c "CREATE DATABASE aiontheballot_restore OWNER aiontheballot_owner"
   pg_restore -U postgres -d aiontheballot_restore --exit-on-error --single-transaction <dump>
   psql -X -U postgres -c "REVOKE ALL ON DATABASE aiontheballot_restore FROM PUBLIC"
   ```

   It should finish with no error. `pg_restore` into an existing database leaves out its database-level grants, so the
   `REVOKE` puts back the baseline migration's: no other app's role may connect. On another server, replay the
   `--globals-only` dump first: the grants name roles that exist only on this one.

3. Check it, in `aiontheballot_restore`:

   ```sql
   SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;  -- the release's last migration
   SELECT count(*) FROM app.tenants;
   SELECT count(*) FROM app.assessment_revisions;
   SELECT count(*) FROM app.files;
   SELECT max(at) FROM app.audit_log;  -- shortly before the dump
   ```

   Compare the counts with the live database's: they should be equal or a little lower.

4. Check the files: restore the volume copy taken after that dump into a scratch namespace, and for every row of
   `SELECT tenant_id, bucket, sha256 FROM app.files` check that the file
   `files/<tenant_id>/<bucket>/sha256/<ab>/<cd>/<sha256>` exists on it (`ab` and `cd` being the hash's first four
   characters) and that `sha256sum` of it gives its name.
5. Drop the scratch database (`DROP DATABASE aiontheballot_restore`) and the scratch namespace, and write the date
   and what was checked in PLAN's tracking table. A drill touches neither the live volume nor its ledger.

## 4. Real restore (operator, then a country admin of each site)

Not between 03:00 and 05:00 UTC, when the API's CronJobs run.

1. **Stop the writes:** tell the chapter the admin is off, and set `aiontheballot-api.replicaCount: 0` in gitops.
   Once Argo has synced, no API pod runs: the admin and the report form are down, and the public site keeps serving
   its last copies. (With the worker on, set `aiontheballot-api.worker.databaseUrlSecret.name` to `''` too.)
2. **List what the restore will rewind**, from the live database (if it can still be read), with the dump's time
   as `<dump time>` (an instant with its offset). The queries print ids and counts, never personal data:

   ```sql
   -- Everything, by site, table and action: what to redo through the admin (§2).
   SELECT tenant_id, table_name, action, count(*) FROM app.audit_log
    WHERE at > '<dump time>' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
   -- For step 4: access removed, invitations revoked, signups gone.
   SELECT row_id FROM app.audit_log
    WHERE table_name = 'memberships' AND action = 'delete' AND at > '<dump time>';
   SELECT row_id FROM app.audit_log
    WHERE table_name = 'platform_admins' AND action = 'delete' AND at > '<dump time>';
   SELECT id FROM app.invitations WHERE revoked_at > '<dump time>';
   SELECT row_id FROM app.audit_log
    WHERE table_name = 'signups' AND action = 'delete' AND at > '<dump time>';
   -- After it opens: reports to anonymize again, reports lost, freeze windows, passwords changed, purges.
   SELECT tenant_id, id FROM app.reports WHERE anonymized_at > '<dump time>';
   SELECT tenant_id, count(*) FROM app.reports WHERE created_at > '<dump time>' GROUP BY 1;
   SELECT tenant_id, slug, frozen_from, frozen_until FROM app.elections WHERE frozen_from IS NOT NULL;
   SELECT user_id FROM auth.accounts WHERE updated_at > '<dump time>';
   SELECT purged_tenant_id, purged_tenant_slug, at FROM app.purge_log WHERE at > '<dump time>';
   ```

   A membership's `row_id` is its key as JSON (`user_id`, `tenant_id`, `role`); a platform admin's is the user's id.

3. **Restore into `aiontheballot_restore`** and check it, as in §3 steps 1 to 3, then let the runtime roles connect:

   ```sql
   GRANT CONNECT ON DATABASE aiontheballot_restore
     TO aiontheballot_web, aiontheballot_admin, aiontheballot_worker, aiontheballot_auth, aiontheballot_sweeper,
        aiontheballot_preview;
   ```

   (The cluster's Postgres provisioning (gitops) grants the same, each time it runs, to the database named
   `aiontheballot`.)

4. **Put access and personal data right**, in `aiontheballot_restore`, with step 2's ids:

   ```sql
   BEGIN;
   DELETE FROM app.memberships WHERE (user_id, tenant_id, role) IN (('<user_id>', '<tenant_id>', '<role>'), …);
   DELETE FROM app.platform_admins WHERE user_id IN ('<user_id>', …);
   UPDATE app.invitations SET revoked_at = now()
    WHERE id IN ('<id>', …) AND accepted_at IS NULL AND revoked_at IS NULL;
   DELETE FROM app.signups WHERE id IN ('<id>', …);
   DELETE FROM auth.sessions;
   -- Each count should match step 2's lists (or be lower, for rows the dump never had). Then:
   COMMIT;
   ```

   Leave out a statement whose list is empty.

5. **Swap the two**, connected to the `postgres` database:

   ```sql
   ALTER DATABASE aiontheballot WITH ALLOW_CONNECTIONS false;
   SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity
    WHERE datname IN ('aiontheballot', 'aiontheballot_restore') AND pid <> pg_backend_pid();
   BEGIN;
   ALTER DATABASE aiontheballot RENAME TO aiontheballot_before_restore;
   ALTER DATABASE aiontheballot_restore RENAME TO aiontheballot;
   COMMIT;
   ```

   Both renames commit together, so a database called `aiontheballot` always exists (the cluster's provisioning
   would otherwise create an empty one). If a rename fails ("being accessed by other users"), nothing changed: run the
   `pg_terminate_backend` statement again and retry, or back out with
   `ALTER DATABASE aiontheballot WITH ALLOW_CONNECTIONS true`. The old database stays, closed to connections.

6. **Bring the schema up to the release:** compare the restored `schema_migrations` with the newest file in
   `db/migrations` of the deployed release. If the dump is older, sync the `aiontheballot` application in Argo CD:
   its migrations job runs before the pods. If a migration caused the damage, fix it forward first (a new migration
   in a release), or the sync applies it again.
7. **Open it again:** set `replicaCount` back (and the worker), and check the admin signs in, the public site shows the
   restored data, and the three addresses answer 200.
8. **Delete the sweep's ledger** (§6).
9. **Through the admin, a country admin of each site:** set the freeze windows again first (step 2's list), then
   anonymize the listed reports again; then the site settings and texts the catch-all list shows changed. Editors
   republish what was published after the dump. The operator purges again any site purged after it.
10. Tell the members whose passwords changed (step 2) to change them again, and the chapter how many reports were
    lost. Tell the chapter the admin is back.
11. After a few weeks with no need for it, drop `aiontheballot_before_restore`, and with it the lost reports.

## 5. Restoring the file volume

Only when the volume itself is lost: with the API at zero replicas (§4 step 1), restore its copy taken
**after** the dump being restored (or after the live database's last write, if the database is fine), open the API
again, then delete the sweep's ledger (§6). A volume copy older than the database's dump lacks the bytes of files
uploaded in between: the API answers those as missing, and their sources must be uploaded again.

## 6. The sweep's ledger

The sweep keeps, on the volume, the time it first saw each file unnamed (`/data/files/sweep-ledger.json`). After
**any** restore of the database or the volume those times are wrong, so the ledger is deleted, which starts every
clock again (ADR-0004 §5). The sweep also notices most restores itself and deletes nothing that run, but a restore of
a volume snapshot can go unseen, so the deletion is never skipped.

1. Check that no sweep or purge is running: `kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" get jobs` shows
   no `file-sweep` job active, and nobody is running `purge-tenant-files.js`.
2. With an API pod running, delete the ledger, and a `sweep.lock` beside it if the restore brought one back:

   ```sh
   kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" exec deploy/aiontheballot-api -- \
     rm -f /data/files/sweep-ledger.json /data/files/sweep.lock
   ```

3. The next sweep logs that it starts every clock again, and deletes nothing.
