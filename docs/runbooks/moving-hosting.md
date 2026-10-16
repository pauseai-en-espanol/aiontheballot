# Moving to other hosting

The cluster is replaceable compute (PLAN P12): the association owns the repository, the domain, the DNS zone, the
mail sender, the error-tracking account and the LLM key, and the deployment is declarative. This runbook moves the
platform to another Kubernetes cluster with the least downtime: the public site stays up throughout, and the admin
is off for about an hour.

## 1. What the new host needs

| Need                 | On the new host                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes, one node | Any recent version; the file volume is one node's (ADR-0004 §6)                                                                        |
| Gateway API and TLS  | A Gateway the routes' `parentRefs` name, and certificates for every hostname; the charts have no Ingress template                      |
| Postgres 18          | One database and six roles: `aiontheballot_owner`, and five runtime roles that own nothing and can't bypass RLS (ADR-0001, Database)   |
| A persistent volume  | Any `ReadWriteOnce` storage class (`aiontheballot-api.persistence.storageClass`)                                                       |
| A registry           | Any registry the cluster can pull from: the release workflow's `DOCKER_REGISTRY` and the gitops `image.repository` values              |
| Secrets              | Sealed again by `scripts/seal-*.sh` with the new cluster's certificate (they take it), or plain Secrets                                |
| Mail                 | Any SMTP submission (`SMTP_URL`), with the sender domain's SPF and DKIM                                                                |
| Optional             | A Sentry-compatible error tracker and Plausible: leave the DSNs and `PLAUSIBLE_URL` unset to go without                                |
| Network policies     | The charts' policies name the gateway's, the database's and the error tracker's namespaces and pod labels: set the new host's (gitops) |

Keep the same `BETTER_AUTH_SECRET`: a new one signs everyone out and breaks every enrolled authenticator.

## 2. Prepare (operator, a week ahead)

1. **Lower the DNS TTL** of every hostname to 5 minutes, at the DNS provider. Retired hostnames move too: they are
   never dropped (ADR-0001, DNS and TLS).
2. **Stand up the dependencies** above, and the roles: replay the `--globals-only` dump, or create them as the
   cluster's Postgres provisioning (gitops) does, with new passwords sealed into the new connection secrets. The
   gateway must take the client's address from the connection and never trust one a client sends: the report form
   counts visitors by it. The web and admin charts can render an Envoy Gateway `BackendTrafficPolicy`
   (`route.trafficPolicy`); on another gateway, turn it off and set equivalent limits there.
3. **Restore the latest dump before the chart's first sync,** into an empty `aiontheballot` owned by
   `aiontheballot_owner`, with `REVOKE ALL … FROM PUBLIC` and `GRANT CONNECT` to the five runtime roles
   ([restoring-the-database.md](restoring-the-database.md) §3 steps 2 and 3, and §4 step 3, with that name). A
   database the chart had already migrated would clash with the dump. Restore the volume copy taken after the dump
   onto the new volume.
4. **Deploy the chart** with the app's values copied from gitops, changed for the new cluster. Its migrations job
   applies only what the dump lacks.
5. **Rehearse:** open the public site and the admin through the new gateway without DNS:

   ```sh
   curl --resolve iaenlasurnas.es:443:<new gateway address> https://iaenlasurnas.es/ -o /dev/null -w '%{http_code}\n'
   ```

   It should answer 200. Issue the certificates by DNS-01 (with a token for the DNS provider), so they exist before
   DNS moves; HTTP-01 would leave a few minutes of TLS errors at the switch.

6. Agree a quiet hour with the chapter, outside a freeze window, away from the campaign's last days, and clear of the
   API's CronJobs (03:00 to 05:00 UTC: session cleanup, report anonymization, and the sweep on Sundays).

## 3. Switch (operator, about an hour)

1. Tell the chapter the admin is off. The public site keeps serving.
2. **Stop the writes on both hosts:** set `aiontheballot-api.replicaCount: 0` in both clusters' values (and
   `aiontheballot-api.worker.databaseUrlSecret.name: ''`, if the worker is on). The old public site keeps serving its
   last copies (ADR-0003 guardrail 3), and the CronJobs don't run in this hour (§2 step 6).
3. **Take the final copies:** a dump as the superuser (`pg_dump -Fc aiontheballot`), then the file volume, in that
   order (bytes before rows: a volume copied after the dump has every file the dump names), for example with a pod
   that mounts the volume and `tar -C /data -cf - files`.
4. **Replace the rehearsal's data on the new host:** drop and recreate its `aiontheballot` as in §2 step 3, restore
   the final dump, replace the new volume's `files` folder with the final copy, and delete the sweep's ledger
   ([restoring-the-database.md](restoring-the-database.md) §6, once its API runs).
5. **Open the new host:** set its `replicaCount` back. Check through its gateway as in §2 step 5: the public site,
   the admin's sign-in, a party page, a share image.
6. **Move DNS without deleting a record.** If the old cluster manages DNS records from its routes (external-dns, for
   example, with `policy: sync`), a hostname taken off its routes would have its record deleted, and resolvers would
   cache the gap:
   1. Stop the old cluster's DNS automation from deleting records (external-dns: `policy: upsert-only`, in gitops).
   2. Take the moved hostnames off the old cluster's routes. Their records stay, still pointing at the old gateway.
   3. At the DNS provider, point each record at the new gateway by hand. The demo's hostname, under the operator's
      own domain, moves the same way.
   4. Hand the records to the new cluster's DNS automation later (external-dns: with its own `txtOwnerId`); until
      then they are managed by hand.
7. **Watch:** the uptime monitors, the error tracker, and the old gateway's traffic falling to nothing within the TTL.
8. Tell the chapter the admin is back. Sessions carried over with the dump stay valid (same secret).

## 4. Afterwards

1. Turn on backups on the new host, and run a restore drill before calling it done.
2. Keep the old database and volume, untouched, for two weeks; then delete them.
3. Update the release workflow's registry and runner, the operator's `.env` (the settings these runbooks and
   `scripts/watch-release.sh` read; README, conventions), and ADR-0001 if the move changes one of its decisions.
4. Raise the DNS TTL again.
