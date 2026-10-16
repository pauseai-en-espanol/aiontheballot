# Incidents

Something is down, wrong, or under attack. First find out which, then follow the matching section.

## 1. Triage (operator, five minutes)

1. **What is affected?** Open the public site, the admin's sign-in page and the demo site. The public pages keep
   serving their last good copy when the API or the database fails (ADR-0003 guardrail 3), so a public site that
   still answers says little about the admin.
2. **Is it deployed as expected?**

   ```sh
   kubectl --context "$KUBE_CONTEXT" -n "$ARGO_NAMESPACE" get application "$ARGO_APP" \
     -o jsonpath='{.status.sync.status} {.status.health.status} {.status.sync.revisions[0]}{"\n"}'
   kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" get pods
   ```

   You should see `Synced Healthy` and the release bot's latest commit on the deployed branch (§3), and every pod
   `Running` and ready (CronJob pods
   `Completed`). A pod in `CrashLoopBackOff` or `ImagePullBackOff`, or a deployment still rolling, points at the
   last release (§3).

3. **What do the apps say?** `kubectl … logs <pod> --since=30m` for each pod `get pods` listed (`logs deploy/…`
   reads only one of a deployment's pods; the worker, when on, is `aiontheballot-api-worker`), and the error tracker
   for the errors themselves. Logs and error reports carry no personal data, so they can be pasted into an issue.
4. **Is it the cluster?** If every app is down at once, or the gateway answers nothing, check the nodes and the
   gateway:

   ```sh
   kubectl --context "$KUBE_CONTEXT" get nodes
   kubectl --context "$KUBE_CONTEXT" get pods -A \
     -l gateway.envoyproxy.io/owning-gateway-namespace="$GATEWAY_NAMESPACE"
   ```

   The API can't start away from the node that holds its file volume (ADR-0004 §6): if that node is gone, wait for
   it, or move ([moving-hosting.md](moving-hosting.md)).

5. **Tell the chapter** (its coordination channel) what is affected and when you'll update them, if editors or the
   public notice it. The site has no status banner; nothing public is said unless the chapter decides to.

## 2. Severity

| Level | Examples                                                                              | Response             |
| ----- | ------------------------------------------------------------------------------------- | -------------------- |
| 1     | Public site down or showing wrong ratings; personal data exposed; an admin taken over | Now, until fixed     |
| 2     | Admin down; publishing blocked; reports not arriving; backups failing                 | Same day             |
| 3     | A share image or a page broken; errors in the error tracker with no visible effect    | Next working session |

Wrong published content is level 1 and is fixed through the editorial workflow, never in the database:
[corrections.md](corrections.md).

## 3. A release broke something

Image tags live in this repository (`helm-charts/aiontheballot/values.yaml`), written by the release bot's
`Release: update image tags [skip ci]` commits. Argo CD deploys `main` (ADR-0001; there is no `production` branch).

1. **Roll the images back** by reverting the bad release's tag commit on `main`, keeping `[skip ci]` in the message:

   ```sh
   git revert --no-edit <tag commit>
   git commit --amend -m "Roll back <deployables> to <previous tags> [skip ci]"
   git push origin main
   ```

   `[skip ci]` matters: CI on that commit would start a release, which rebuilds every deployable whose version
   differs from its tag (`scripts/release-plan.sh`) and writes the bad tags back. A commit that changes only the
   chart's tags marks no deployable, so the pre-push checks let it through. The other way round, GitHub skips CI for
   any push whose last commit's message holds that marker anywhere, so an ordinary commit must never quote it.

2. **Watch it roll out** (`scripts/watch-release.sh` waits for a CI run, which `[skip ci]` never starts):

   ```sh
   kubectl --context "$KUBE_CONTEXT" -n "$ARGO_NAMESPACE" get application "$ARGO_APP" \
     -o jsonpath='{.status.sync.status} {.status.health.status} {.status.sync.revisions[0]}{"\n"}'
   kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" get pods
   curl -s -o /dev/null -w '%{http_code}\n' https://<each address>
   ```

   You should see `Synced Healthy` at the revert's commit within a few minutes, the previous tags' pods running, and
   200 from each address.

3. **Migrations don't roll back.** They are forward-only, and the migrations job of the older image applies nothing
   new. If a migration broke something, the fix is a new migration, released normally. If it lost data,
   [restoring-the-database.md](restoring-the-database.md).
4. The next push to `main` releases again, so it must carry the fix (with its changeset).
5. **New images the cluster isn't allowed to pull** are not the release's fault: the registry no longer accepts the
   pull secret. Argo CD waits on the migrations hook, whose pod is in `ImagePullBackOff` with `401 Unauthorized` in
   its events (`kubectl … get events`), until the Job fails with `DeadlineExceeded`. (An image that isn't there,
   `not found`, is the release's: steps 1 to 4.) The running pods keep their images while
   they stay where they are, but a pod moved to another node can't start either, so fix it soon:
   1. Renew the pull robot in the registry: its secret, and its expiry or rights if those lapsed.
   2. Run `scripts/seal-registry-pull-secret.sh <gitops checkout>`. It checks the secret with the registry, then
      seals it; commit and push that file in gitops.
   3. A sync already running stays on the revision it started with, through its retries. To skip the wait, terminate
      it in Argo CD and sync the whole application (a sync of selected resources skips the hooks); otherwise the next
      automated sync takes the new secret.

## 4. The database is unreachable or failing

1. The API answers 503 and logs connection errors; the admin shows errors; the public pages keep their last copy.
   Its pools drop a lost connection and open another when Postgres is back (PLAN R153), so no restart is needed.
2. Check the Postgres pod and its logs:

   ```sh
   kubectl --context "$KUBE_CONTEXT" -n "$DATABASE_NAMESPACE" get pods
   kubectl --context "$KUBE_CONTEXT" -n "$DATABASE_NAMESPACE" logs "$DATABASE_POD" -c postgres --since=30m
   ```

   A full disk shows as write errors. The file volume may share a disk with the database's, and its storage class
   may not cap its size (ADR-0004 §6), so check both.

3. A runtime role refused (`password authentication failed`) after a secret changed: the role's password in the
   cluster's Postgres provisioning and the app's connection secret must be sealed from the same value
   (`scripts/seal-gitops-secrets.sh`; the rotation steps are in gitops).
4. Data lost or damaged: [restoring-the-database.md](restoring-the-database.md).

## 5. An admin account is compromised

1. **The operator** ends their sessions first, and if they are a platform admin, takes that away too: no screen
   does, and a platform admin can give themselves any site's roles again.

   ```sql
   BEGIN;
   DELETE FROM auth.sessions
    WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('<their email>'));
   DELETE FROM app.platform_admins
    WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('<their email>'));
   -- DELETE n: their open sessions, then 1 or 0. Then COMMIT.
   COMMIT;
   ```

2. **A country admin or platform admin** removes the person's roles on each site (admin, Members), and revokes the
   invitations they sent that are still pending. It takes effect on their next request (editorial workflow A7).
3. Read what they did in the audit view (country admins: their site's; platform admins: everything), filtered by the
   person. Anything published goes through [corrections.md](corrections.md).
4. Once their email account is theirs again, they choose a new password ("I forgot my password" on the sign-in page,
   or a reset email a country admin sends from Members; PLAN R170), which also ends any session left. Their roles come
   back only by invitation.
5. A lost authenticator is a different case: §5a; a forgotten password with no authenticator, §5b.

## 5a. A member lost their authenticator

The person's authenticator app is gone (a lost or reset phone). With backup codes left, they sign in with one (each
works once) and nothing is urgent; without, they can't sign in at all. Either way the fix is the owner-run reset
(editorial workflow A5.4, PLAN R156): it removes the account's authenticator and backup codes, ends its sessions and
forgets any unused password reset link (PLAN R179), and the next sign-in with the password enrols a new one. The
password, roles and any platform-admin row stay, and give nothing until the new enrolment (ADR-0002 §9). Never
improvise it in SQL.

1. **A country admin of their site confirms it is them,** by a channel the chapter already uses with that person (a
   call, not only an email or message that someone else could have sent), and gives the operator the account's email
   address as the site's Members page shows it. For a platform admin, another platform admin or the chapter's
   coordinator does.
2. **Agree a moment** when they will sign in straight after the reset: until they enrol, whoever signs in with their
   password enrols an authenticator. If the password may be known to anyone else, they first choose a new one ("I
   forgot my password", or a reset email from Members; editorial workflow A5.2, PLAN R170), so only they know it when
   the reset happens. If their email account may be someone else's too, stop here and treat it as a compromised
   account (§5).
3. **The operator runs the command** in an API pod, with `-it` so it can ask (never `kubectl run`, whose output the
   pod's log keeps). It asks for the email address twice, so the address appears in no command line or log and a slip
   in it changes nothing, and prints no personal data:

   ```sh
   kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" exec -it deploy/aiontheballot-api -- \
     node dist/reset-authenticator.js
   ```

   You should see `Account <id> has an authenticator and <n> open session(s).`, then, after typing `reset`,
   `Done: account <id> has no authenticator now, and <n> session(s) ended.` Anything else changes nothing: two
   addresses that differ, no account with that address, an account with no authenticator (it enrols at its next
   sign-in already), or an answer other than `reset`. If it says `The reset failed (…), and may not have been
applied`, run it again: it then says whether the account still has an authenticator. A code someone was entering
   at that very moment can't leave a session behind (PLAN R156).

4. **They sign in** with their password, scan the new QR code, enter a code, and keep the ten new backup codes. They
   should reach their site's dashboard. If sign-in asks them for a code they never set up, someone else enrolled
   first: treat it as compromised (§5) and reset again only once that is settled.
5. **Record it** in the issue tracker: the account's id (never the email), who asked, who confirmed it was them, and
   when. The database keeps no audit of Better Auth's tables, so this note is the record.

**Rehearsal** (launch checklist): on an account made for it with `create-account.js` (PLAN R93) and given no role, go
through steps 3 and 4, then delete it, as the superuser (README, conventions), with its id from the command:

```sql
BEGIN;
SELECT (SELECT count(*) FROM app.memberships WHERE user_id = '<id>') AS roles,
       (SELECT count(*) FROM app.platform_admins WHERE user_id = '<id>') AS platform_admin;
-- Both must be 0: an account with a role is someone's, never a rehearsal's. Otherwise ROLLBACK.
DELETE FROM auth.verifications WHERE value = '<id>';
DELETE FROM auth.users WHERE id = '<id>';
-- DELETE 1: its sessions, password and factor go with it. Then COMMIT.
COMMIT;
```

## 5b. A member with no second factor forgot their password

The person set a password but never enrolled an authenticator (they accepted an invitation and stopped there, or the
owner reset theirs, §5a) and has forgotten it. "I forgot my password" sends nothing to such an account, and nor does
a reset email from Members: a new password would let whoever reads the mailbox enrol their own authenticator (D19).
The way back is the owner's command, which prints a link that sets a new password; whoever holds that link gets the
account, so it goes only to the person, after this check.

1. **Someone asks for them,** usually a country admin of their site, with the account's email address as the site's
   Members page shows it. Nothing is changed yet.
2. **The operator runs the command** in an API pod, with `-it` so it can ask (never `kubectl run`, whose output the
   pod's log keeps). It asks for the address and prints no personal data:

   ```sh
   kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" exec -it deploy/aiontheballot-api -- \
     node dist/create-account.js
   ```

   You should see `Account <id> has a password and no second factor yet.` and a read-only query with that id. Leave
   the command waiting (or stop it with Ctrl-C and run it again later: nothing has changed). An account with its
   second factor is refused (`has a second factor`: its person uses "I forgot my password", or a reset email from
   Members; a lost authenticator is §5a). An address with no account says so and asks for a name, which would create
   one: stop there (Ctrl-C) unless that is what you meant.

3. **The owner runs the query** as the database owner: it changes nothing and lists the account's roles, one row per
   site (its slug and role) and `platform | platform_admin` for a platform admin. The link opens all of them.
4. **Someone entitled to confirms it is them,** by a channel the chapter already uses with that person (a call, not
   only an email or message that someone else could have sent): a country admin of every site in that list where the
   account is a country admin (for an account that is country admin of none, of any site in the list); for a platform
   admin or an account with no role, another platform admin or the chapter's coordinator. The operator reaches the
   confirmer, and then the person, by a channel the operator knows independently, never one given by whoever asked,
   who doesn't count unless they are that person. If their email account may be someone else's too, stop here and
   treat it as a compromised account (§5). **Agree a moment** with them for step 6.
5. **The operator finishes the command:** the same address again, then `link`, so a slip in the address changes
   nothing. You should see `Account <id>: a link for a new password.`, that its old password and sessions have ended
   and any earlier link no longer works, and the link. Two addresses that differ, or an answer other than `link`,
   change nothing.
6. **Give the link to the person yourself,** at the agreed moment, by the channel you confirmed them on: never through
   whoever asked, and never to the account's email address. It works once, within the hour; a new run makes a new one
   and the old stops working.
7. **They set a new password and sign in.** The account's address gets a "your password was changed" email. The next
   sign-in asks them to enrol an authenticator, and they keep the ten backup codes. If sign-in asks them for a code
   they never set up, someone else enrolled first: treat it as compromised (§5).
8. **Record it** in the issue tracker: the account's id (never the email), who asked, who confirmed it was them, and
   when.

## 6. A secret leaked

1. Rotate it: generate and seal a new value with the script that made it (`scripts/seal-*.sh`; the rotation steps are
   in gitops), and let Argo CD roll the pods.
2. A database password: the Postgres role and the app's connection secret change together (§4.3).
3. The registry's pull secret: renew the robot in the registry, then `scripts/seal-registry-pull-secret.sh` (§3). From
   the renewal until the sync lands, new pods can't pull, so do both together; running pods are unaffected.
4. `BETTER_AUTH_SECRET` signs everyone out and breaks every enrolled authenticator; rotate it only if it leaked.
5. The worker's token (`scripts/seal-worker-token-secret.sh`): the API and the worker read the same secret, so they
   change together on the next rollout; jobs open in between are redelivered (ADR-0006).

## 7. A traffic spike

1. The public site serves from memory; images have content-hash URLs (ADR-0001, Traffic spikes). Check the web pods'
   CPU and memory (`kubectl … top pods`) and the uplink.
2. If the cluster or its uplink can't keep up, put a CDN's proxy in front, following ADR-0001's contingency: the
   proxy turned on from the route's DNS annotation (gitops), not the provider's dashboard alone; TLS to the origin
   verifying its certificate; a cache rule for HTML. First set the gateway's per-address limits to 0 in gitops
   (`aiontheballot-web.route.trafficPolicy.rateLimit`, PLAN R158, and the admin's, `aiontheballot-admin.…`, R208, if
   the admin goes behind the proxy too): behind a proxy every visitor comes from a few of its addresses, which the
   limits would throttle all together. Plausible then sees the proxy's addresses too.
   Undo it when the spike is over, the limits last.
3. **Visitors get a bare "Too Many Requests" (429)** from the gateway, not the site's own words: a crowd behind one
   address (a venue's wifi, a carrier) passed a per-address limit. Raise that group's number in gitops, or set it to
   0; never turn off Envoy Gateway's rate-limit service while any number is set, on the web's chart or the admin's,
   or that whole route answers 500 (for the admin, sign-in included).

## 8. Spam or abuse through the report form

1. The API limits each visitor (3 per 10 minutes, 10 per day) and each site per UTC day; once a site's limit is
   reached, the form says so until the next UTC day. Spam then fills the queue but nothing else.
2. Members mark it as spam in the admin (Reports); it is anonymized with the rest when its retention ends.
3. To close the form, remove `aiontheballot-api.reports.anonymize.databaseUrlSecret` in gitops: the form closes with
   the anonymization job (PLAN R149), which catches up on the next run once it is back.
4. The gateway's per-address rate limits (ADR-0001; the numbers are set in gitops) are the lasting fix.

## 9. Personal data exposed

1. Stop the exposure first (roll back, close the form, take the page down through a release).
2. Record what was exposed, to whom and for how long, from the logs and the audit view.
3. Tell the chapter's privacy contact (PLAN Q7) at once: a breach may have to be notified to the data protection
   authority within 72 hours, which is their call, not the operator's.

## 10. Afterwards

Write a short note (what happened, the impact, the cause, what changed) in the issue tracker, and update the
runbook that was used.
