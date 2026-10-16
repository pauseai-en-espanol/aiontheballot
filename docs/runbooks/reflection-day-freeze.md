# Reflection-day freeze

Each election has a **freeze window**: from its start until its end (or until cleared), nothing public about the
election changes. Whether to use it, and from when to when (reflection day, polling day, a longer campaign
blackout), is **the chapter's call under its legal advice** (PLAN Q8); this runbook only says how. The dates come
from that advice and the election's own date in the admin, never from this document.

## What the window does and doesn't stop

| Stopped by the database (editorial workflow E6)                  | Not stopped                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Publishing a revision: ratings, corrections, withdrawals         | Drafting, submitting, reviewing and commenting               |
| Approving a change request (names, dates, criteria, methodology) | Right-of-reply reports arriving and being triaged            |
| Changing a party's programme status                              | Site-wide settings: theme, policy texts, organization, brand |
| Archiving the election (PLAN R109)                               | Code releases                                                |
|                                                                  | Taking a draft election live, or announcing it               |

The public site keeps serving exactly what was published before the window: pages, share images and the
corrections log. Site-wide settings, releases and going live are kept still by agreement (below), not by the
database.

## Before (a country admin, at least a few days ahead)

1. Agree the window with the chapter: its start and end as instants, with their time zone. If the vote spans more
   than one time zone, the window covers the latest.
2. In the admin, open the election's overview, **Freeze window**: enter **From** and **Until**. Times are the
   browser's; the overview then shows the window in UTC. Check that the UTC instants are the agreed ones. Leaving
   **Until** empty freezes until someone clears it.
3. Save. Every election screen shows a banner with the window, and the change is in the audit log.
4. Tell the editors: anything meant to be public before the window must be **published** before its start; drafts
   in review then wait until it ends.
5. Operator: no releases from the day before the window until it ends, except a fix for an outage
   ([incidents.md](incidents.md)). The launch code freeze already limits releases to content and hotfixes.
6. Country admins: no site-wide changes (theme, policy texts, organization, brand, site settings) during the window,
   and no election taken live or announced in it.

## During

1. Nothing to do. A publish or approval attempt is refused with "reload" and the banner's explanation.
2. Reports keep arriving: triage them as usual; corrections they lead to publish after the window.
3. An urgent problem that can't wait (a serious factual error, say) is the chapter's decision under its legal
   advice. Only a country admin or a platform admin can clear the window, which is audited; if they do, publish only
   that fix, through review, and set the window again at once.

## After

1. With an **Until**, the window ends on its own: publishing works again at that instant. Without one, a country
   admin clears it (**Clear freeze window**).
2. Editors publish what waited in review, checking each draft still holds (results may have changed what is worth
   publishing).
3. Archive the election once the chapter is done with it (editorial workflow E7). Archiving is refused while a
   window is set and not over, since an archived election couldn't clear it and its corrections would wait forever.
