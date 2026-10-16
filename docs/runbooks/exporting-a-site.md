# Exporting a site's data

A site's operator asks for everything the platform holds of its site: to keep its own records, to answer a data
processing agreement (BRIEF §7), or to move elsewhere. The export is read-only and complete: every row of the site in
every table, the files' bytes, and the few shared rows that give them meaning (data model §3; PLAN R160). It holds
personal data (right-of-reply reports, the signup list, invitations, members' names and emails), whose controller is
the site's operator, so it goes only to them and is handled as they would handle it.

**Who:** the operator of the cluster, on a written request from someone who speaks for the site's operator (its legal
representative or the chapter's coordinator), confirmed by a channel the chapter already uses with them. A platform
admin's request alone isn't enough: platform admins don't read reports (PLAN P11).

## What it holds

- **`<site>.jsonl`**, from `scripts/export-tenant.sql`, one JSON document per line: a header (the site's short name and
  id, when, which database), then one line per table with all of the site's rows, then a footer with how many lines
  came before it, so a file cut short shows. The tables are every table of `app` with a `tenant_id` (a database test
  fails when one is missing from the script), the site's own row, the organizations it links, the brand assets it
  selects or was granted and the core criteria its criteria map to, and its members' names and emails. Never a
  password, an authenticator, a session or a token's hash (they are left out of the audit log's diffs too).
- **`<site>-files.tar`**: the bytes of the site's stored files (sources and public assets), from the API's volume,
  under `<site id>/<bucket>/sha256/…`. Each is named by its SHA-256, which `app.files` rows in the export name.
- Not in it: the platform's own brand assets' bytes (shared, under `platform/`), backups (their own retention), error
  reports (they carry no personal data), visit counts (Plausible's own export, per site), mail logs (the SMTP
  sender's).
- The script is run whole, not shown here, against the README's convention: it is plain SQL, read-only, and its
  database test (`packages/db/tests/export.spec.ts`) checks what it gives and what it leaves out.

## Steps (operator)

At a quiet hour: the database snapshot and the files are read a minute apart, and an upload or a sweep in between
would make them disagree. In bash, with the settings loaded (README, conventions), where `set -euo pipefail` stops at
the first failure or unset setting; `<site>` is the site's short name and `<repo>` this repository's checkout at the
deployed release (the script must know every table of its schema).

1. **Work in a new folder on the computer's own, encrypted disk**, outside the repository, any synced folder and any
   backup, never on an external volume:

   ```sh
   set -euo pipefail
   REPO=<repo>; SITE=<site>
   WORK=$(mktemp -d); cd "$WORK"; echo "$WORK"
   ```

   You should see a folder under `/var/folders/…`. The repository's `.gitignore` refuses export files too, as a
   backstop.

2. **Export the database**, in one read-only, consistent snapshot, as the superuser in the Postgres pod:

   ```sh
   kubectl --context "$KUBE_CONTEXT" -n "$DATABASE_NAMESPACE" exec -i "$DATABASE_POD" -c postgres -- \
     sh -c "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -X -q -U postgres -d aiontheballot -v slug=$SITE" \
     < "$REPO/scripts/export-tenant.sql" > "$SITE.jsonl"
   ```

   You should see no output and exit status 0. A short name no site has stops it with `no site has the short name …`.
   Check it is whole: `tail -n 1 "$SITE.jsonl"` shows `{"end" : true, "lines" : N}`, and `wc -l < "$SITE.jsonl"` is
   N + 1.

3. **Check it is the site that was asked for,** against the hostname and operator named in the written request:

   ```sh
   python3 - "$SITE.jsonl" <<'PY'
   import json, sys
   lines = [json.loads(line) for line in open(sys.argv[1])]
   table = {line['table']: line['rows'] for line in lines if 'table' in line}
   print('site:', table['app.tenants'][0]['display_name'])
   print('hostnames:', [h['hostname'] for h in table['app.tenant_hostnames']])
   print('operator:', [o['legal_name'] for o in table['app.organizations']])
   PY
   ```

   If anything differs from the request, stop and delete the folder (step 7).

4. **Export the files' bytes** from the API's volume, by the site's id from the header:

   ```sh
   SITE_ID=$(head -n 1 "$SITE.jsonl" | python3 -c 'import json, sys; print(json.load(sys.stdin)["tenantId"])')
   [[ "$SITE_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "no site id"; exit 1; }
   kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" exec deploy/aiontheballot-api -- \
     tar -C /data/files -cf - "$SITE_ID" > "$SITE-files.tar"
   ```

   You should see no output. Then check that every file a row names is in it, by bucket and hash:

   ```sh
   python3 - "$SITE.jsonl" "$SITE-files.tar" <<'PY'
   import json, sys, tarfile
   rows = next(json.loads(l)['rows'] for l in open(sys.argv[1]) if '"app.files"' in l[:40])
   named = {(r['bucket'], r['sha256']) for r in rows}
   stored = {(p.split('/')[1], p.split('/')[-1]) for p in tarfile.open(sys.argv[2]).getnames() if p.count('/') == 5}
   print(len(named), 'named,', len(named - stored), 'missing,', len(stored - named), 'stored but unnamed')
   PY
   ```

   You should see `0 missing`. Bytes stored but unnamed are uploads a sweep hasn't removed yet; files a sweep set
   aside (`/data/files/retired/`) and the platform's own brand assets (`/data/files/platform/`) aren't in it.

5. **Package and encrypt** it for the person who asked, to a key they gave you (`age`), then delete the plaintext at
   once, keeping only the encrypted file:

   ```sh
   tar -czf - "$SITE.jsonl" "$SITE-files.tar" | age -r '<their age public key>' > "$SITE-export.tar.gz.age"
   rm "$SITE.jsonl" "$SITE-files.tar"
   ```

   If they have no key, use a passphrase (`age -p`) agreed by another channel, never in the same message.

6. **Hand it over** by a channel agreed with them, and wait for them to confirm it opens.
7. **Delete the folder** (`rm -r "$WORK"`), and anything a download kept. The platform keeps nothing of the export.
8. **Record it** in the issue tracker: who asked, who confirmed it, when, the footer's count and step 4's numbers, and
   how it was handed over. Never the data itself.

## Afterwards

- **Moving the site elsewhere:** the rows follow the schema of the release that exported them (`db/schema.sql` at
  that commit); the platform has no import yet. A site that leaves is then purged (`private.purge_tenant`, owner only),
  which is a separate decision.
- **A data subject's request** (access or erasure) is the site's operator's to answer; this export can serve an access
  request, but erasing a report is done in the admin (anonymize, editorial workflow H2.5), not here.
- **Rehearse it** before launch on the demo site (launch checklist), following every step but the hand-over.
