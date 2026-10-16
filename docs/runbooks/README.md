# Runbooks

What to do, step by step, when something rare happens (PLAN M5). Each runbook says who acts, what they run, and what
they should see. The [launch checklist](../launch-checklist.md) links the ones to rehearse before launch.

| Runbook                                             | When                                                          |
| --------------------------------------------------- | ------------------------------------------------------------- |
| [Incidents](incidents.md)                           | Something is down, wrong or under attack                      |
| [Corrections](corrections.md)                       | A published rating or structure is wrong, or a report says so |
| [Reflection-day freeze](reflection-day-freeze.md)   | Before, during and after the days nothing public may change   |
| [Restoring the database](restoring-the-database.md) | Data is lost or damaged, or a backup is tested                |
| [Moving to other hosting](moving-hosting.md)        | The cluster can't host the platform any more                  |
| [Domain renewal](domain-renewal.md)                 | Every year, and whenever a hostname is added or retired       |
| [Exporting a site](exporting-a-site.md)             | A site's operator asks for all of its data                    |

## Conventions

- **Who:** the operator is whoever runs the cluster (today Dani); the chapter's **country admins** run the admin
  screens. Each step names one of them.
- **Settings:** commands name the deployment through shell variables, which the operator keeps in the gitignored
  `.env` (none is a secret; `.env.example` lists them) and loads into the shell from the repository root before
  running any:

  ```sh
  set -a; . ./.env; set +a
  ```

  | Variable             | What it names                                                     |
  | -------------------- | ----------------------------------------------------------------- |
  | `KUBE_CONTEXT`       | The kubectl context of the cluster that runs the platform         |
  | `APP_NAMESPACE`      | The app's namespace (`aiontheballot` by default)                  |
  | `ARGO_NAMESPACE`     | Argo CD's namespace                                               |
  | `ARGO_APP`           | The app's Argo CD application (`aiontheballot` by default)        |
  | `DATABASE_NAMESPACE` | The namespace of the Postgres that holds `aiontheballot`          |
  | `DATABASE_POD`       | Its Postgres pod (with a container named `postgres`)              |
  | `GATEWAY_NAMESPACE`  | The namespace of the Gateway the routes use, and its certificates |

- **kubectl** always with `--context "$KUBE_CONTEXT"`, and in `-n "$APP_NAMESPACE"` unless a step says otherwise.
  Argo CD syncs automatically and heals drift, so a change made with kubectl (scaling, editing) is undone within
  minutes: lasting changes go through gitops or this repository.
- **SQL** is run by the operator as the database's superuser, in the Postgres pod:

  ```sh
  kubectl --context "$KUBE_CONTEXT" -n "$DATABASE_NAMESPACE" exec -it "$DATABASE_POD" -c postgres -- \
    sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -U postgres -d aiontheballot'
  ```

  The superuser bypasses row-level security and can disable triggers: every statement in a runbook is shown in
  full, and nothing else is run that way. Wrap a change in `BEGIN; … COMMIT;` and check its counts before
  committing.

- **Secrets** are never printed: to check one, list its key names only.
- **Times** are in UTC unless a step says otherwise; the admin shows instants in the browser's time.
- After a runbook is used for real, add what was learned to it.
