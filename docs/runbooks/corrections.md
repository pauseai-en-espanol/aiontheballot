# Corrections

A published rating, quote or piece of structure is wrong, or someone says it is. Corrections go through the same
workflow as everything else, in the admin, and leave a public record: the election's corrections log. **Never fix
published content in the database:** the triggers refuse it, and a fix that skipped review would leave no public
note.

## 1. Where it comes from

- **A right-of-reply report** (the public form): it lands in the admin's **Reports** queue as new. Members of the
  site see it; platform admins never do (editorial workflow H2).
- **A member notices**, or someone writes to the chapter: an editor starts at step 3 directly. If it came by email,
  the chapter may ask them to use the form, so the record is in one place.

## 2. Triage the report (any editor, reviewer or country admin)

1. Open it under Reports and mark it **triaged**: it records who and when.
2. Read the cell or page it names against the sources. A report about a cell with no published rating names it in
   its message instead.
3. Decide: **accepted** (something must change), **rejected** (nothing is wrong), or **spam**. Each is a one-way
   step with an internal resolution note: say what was checked and why. The report itself never changes.
4. Accepting doesn't wait for the fix: the correction may still be in review.

## 3. Fix a rating (an editor, then a reviewer)

1. Open the cell and edit it: a new draft starts, and the public keeps the published revision until the next one is
   published.
2. Choose the **change kind**:
   - **correction:** what was published was wrong;
   - **update:** the facts changed, such as a new programme;
   - **withdrawal:** the rating must go, with no new one yet (the cell then shows as withdrawn, not pending).
3. Write the **public note** in the site's default language and every language it publishes: what changed and why,
   without naming the reporter.
4. Fix the quotes and sources as for any rating; the verbatim match and the evidence rules apply again.
5. Submit for review. A reviewer who didn't edit the draft publishes it (four-eyes, unless a platform admin turned it
   off for the election; then publishing one's own correction is recorded as self-reviewed).
6. If a report prompted it, choose the report in the draft's form (after the first publish; PLAN R157): publishing
   keeps the link in the revision's private record, and the report's page lists the correction.

## 4. Fix structure (an editor proposes, a country admin approves)

Names, dates, criteria wording, the methodology and its reviewers are change-controlled once the election is live
(editorial workflow CR1).

1. Next to the field, **Propose a change**: the new value and a public note.
2. If a report prompted it, choose the report in the form.
3. A country admin (or a platform admin) approves; while the site requires a second approver, not the proposer.
   Approving applies the change and writes its public record.

## 5. Check it is public (whoever published)

1. The public site shows it within seconds (PLAN R151), or within a minute if a replica missed the notice.
2. The election's **corrections log** (linked from every election page's footer) lists it with its note and date.
3. Share images change with the content; the party and cell cards carry their "updated" date (PLAN P9), so older
   screenshots are recognisable.
4. A link already shared on Facebook keeps its old preview for days. If the correction changed what the preview
   shows, paste the page's address into Facebook's Sharing Debugger and press **Scrape Again** (by hand: the platform
   has no Facebook app; PLAN R166). WhatsApp offers no such refresh, so a new share there may show the old
   preview for a while.

## 6. Close the loop (country admin)

1. If the report left contact details and the chapter answers, it does so from its own address; the app sends no
   replies.
2. A reporter may ask for their details to be removed: **Anonymize** on the report removes every personal field at
   once. Otherwise they go when the site's retention period ends.

## Special cases

- **Inside a freeze window** nothing public changes, corrections included: drafts and reviews go on and publish once
  the window ends. Only a country admin or a platform admin can clear a window early, which is the chapter's call
  under its legal advice ([reflection-day-freeze.md](reflection-day-freeze.md)).
- **An archived election** still takes corrections and withdrawals, under the same review rule and with a public
  note (PLAN P16).
- **An urgent error** (a quote attributed to the wrong party, say) is still a reviewed correction or withdrawal; the
  fastest path is an editor and a reviewer on it together, not a database edit.
- **A party asks to be removed,** or disputes a rating's fairness rather than a fact: that is the chapter's editorial
  decision. Record the outcome in the report's resolution note.
