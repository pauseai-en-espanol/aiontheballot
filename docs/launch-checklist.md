# Launch checklist

Signed off at the launch go/no-go (PLAN, Gates), item by item, by the person named; a code freeze follows in which
only content changes and hotfixes are released. An item that can't be ticked is either fixed or explicitly waived
at the go/no-go, with the reason written next to it. Copy this list into the go/no-go's issue and tick it there.

## Content and editorial (the chapter)

- [ ] PLAN Q5 to Q9 answered: which parties, the legal notice data, the privacy contact and report retention, the
      electoral-law advice (and so whether and when to freeze), and admissible sources.
- [ ] The methodology is complete and published; its external reviewers are named.
- [ ] Every party and criterion is entered, and the cells planned for launch are published through review.
- [ ] The legal notice, privacy policy and operator page are published in every language the site offers.
- [ ] The site's report retention period is set (editorial workflow T3).
- [ ] Every member has enrolled TOTP and kept their backup codes; nobody who left still has a role (Members).
- [ ] Four-eyes is on for the election, or its being off is a recorded decision.
- [ ] The freeze window is set, if the chapter's advice calls for one
      ([reflection-day freeze](runbooks/reflection-day-freeze.md)).

## Security (operator, with a second reviewer)

- [ ] A second person has reviewed the RLS policies and the isolation matrix (M5).
- [ ] The security audit is done: headers and CSP, dependencies (`pnpm audit`), secrets, and the error tracker's
      events checked for personal data.
- [ ] The gateway's per-IP rate limit covers the report, image, error-relay and analytics-relay endpoints (ADR-0001,
      Traffic spikes; PLAN R158), the admin's error relay included (R208): Envoy Gateway's rate-limit service runs, the
      numbers are set, and a burst gets 429.
- [ ] The operator has rehearsed the reset of a lost authenticator once, in production, on an account made for it
      and deleted afterwards ([incidents](runbooks/incidents.md) §5a, rehearsal; editorial workflow A5.4, PLAN R156).
- [ ] Every secret was generated for production and sealed, never printed; none is shared with the demo or a test.

## Operations (operator)

- [ ] Backups run as the backup plan says (gitops) and are kept off the node (PLAN D2), a failed one alerts someone,
      and a **restore drill** passed: the database and the file volume
      ([restoring the database](runbooks/restoring-the-database.md) §3).
- [ ] Invitations and password resets arrive, from the platform's sender, with SPF and DKIM passing.
- [ ] Off-node uptime monitors watch every hostname, aliases and retired ones included, with alerts and certificate
      expiry warnings (ADR-0001, Operations).
- [ ] The load test ran and the uplink has headroom (PLAN D6); the CDN-proxy contingency was tried once.
- [ ] The incident rollback was rehearsed once: a tag commit reverted with `[skip ci]`, then restored
      ([incidents](runbooks/incidents.md) §3).
- [ ] The report form is open: the anonymization job is configured, which opens it (PLAN R149).
- [ ] If extraction is used, the worker is on and its startup self-check passed (ADR-0006).
- [ ] Every domain's auto-renew is on and its expiry is more than six months away
      ([domain renewal](runbooks/domain-renewal.md)).
- [ ] Error-tracking alerts reach someone who will act on them during the campaign.
- [ ] The export of one site's data was rehearsed on the demo site, every step but the hand-over
      ([exporting a site](runbooks/exporting-a-site.md); data model §3, PLAN R160).

## Accessibility (a person other than the builder)

- [ ] A manual pass against WCAG 2.2 AA on the scorecard, a party, a criterion, a cell, the methodology, the report
      form and the corrections log, with a keyboard and a screen reader.
- [ ] Ratings are never told by colour alone: icon, text and colour, on pages and share images.

## The public site (a platform admin)

- [ ] The real site is open and indexed; the demo stays out of search engines.
- [ ] The site's Plausible script is set, and visits show in Plausible.
- [ ] Share images render for every view and the download dialog offers its four sizes.
- [ ] The sitemap lists the site's pages, and the corrections log page answers.
- [ ] A test correction was published end to end on the demo site and appeared in its corrections log within
      seconds ([corrections](runbooks/corrections.md)).

## Go/no-go

- [ ] Every item above ticked or waived with a reason.
- [ ] The code freeze is announced: until the election is archived, only content changes and hotfixes.
- [ ] Signed off by the chapter's coordinator and the operator, with the date, in the go/no-go's issue.
