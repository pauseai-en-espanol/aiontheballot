# Domain renewal

A domain that lapses takes its sites down, and anyone can then buy it and serve whatever they like under addresses
that shared images and links still carry (ADR-0002 threat T21). Every hostname the platform has ever used publicly is
kept: renewed, in DNS, routed and on the certificate.

The registrar, the account holder and the expiry dates are the chapter's records, kept with its other accounts (PLAN
P12: the association owns the domain), not in this repository. The one exception is the demo site's hostname, under
the operator's own domain, which the operator renews; it serves only fictional content.

## Every month (operator)

1. Check each domain's expiry is more than 60 days away, in the registrar's panel, and that auto-renew is on.
2. Check the certificates: cert-manager renews them about 30 days before they expire.

   ```sh
   kubectl --context "$KUBE_CONTEXT" -n "$GATEWAY_NAMESPACE" get certificates
   ```

   Every one should be `READY True`. The uptime monitors also warn before a certificate expires (launch checklist).

## Every year, two months before a domain expires (the chapter's account holder)

1. Confirm auto-renew is on and the payment method works (a card that expired is the usual way domains lapse).
2. Confirm the holder's and administrative contact's details are current and their email is read: the registry's
   and the registrar's notices go there.
3. Renew for more than a year if the chapter can: fewer chances to miss one.
4. Record the new expiry date in the chapter's records.

## When a hostname is added

1. A platform admin adds it to the site; it is verified by DNS TXT record (ADR-0002, Hostnames).
2. The operator adds it to the web route's `hostnames` in gitops, once verified. A hostname one label under a
   domain already served (`es.example.org` under `example.org`) is covered by its wildcard; a deeper one is not.
3. A **new domain** goes on the gateway's certificate too (apex and wildcard, in gitops), and only once its zone is
   at the DNS provider and cert-manager can solve its DNS challenge there: a zone it can't reach stops the renewal of
   a certificate that other sites share. Add it to the DNS automation's domains too (gitops), and to this runbook's
   monthly check and the chapter's records.
4. Add an uptime monitor for it.

## When a hostname is retired

Nothing is removed. It stays verified-but-retired in the database (it can't be deleted), in DNS, on the route and on
the certificate, and its domain keeps being renewed. A retired alias redirects to the canonical address, so old links
and shared images keep working.

## If a domain lapsed

1. Renew it at once: most registries keep a lapsed domain for its holder for a while, at a higher fee.
2. Check DNS resolves again (`dig +short <domain>`), the certificate is valid, and the uptime monitors are green.
3. Follow [incidents.md](incidents.md) for the downtime, and add the cause here.
