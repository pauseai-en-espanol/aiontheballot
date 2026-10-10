# Spec: editorial workflow (admin)

- **Status:** Draft, for review.
- **Relates to:** [data model](data-model.md) (where each rule lives),
  [ADR-0002](../adr/0002-tenancy-and-authorization.md) (roles, RLS, data rules),
  [ADR-0003](../adr/0003-application-stack.md) (Better Auth, the API, the admin app), BRIEF §2–§5, PLAN M2.

This spec says what the admin (`apps/admin` plus the API's admin routes) lets each role do, as user stories with
testable acceptance criteria. It is what M2 builds. The data rules already live in the database (migrations 1–28):
where a criterion repeats one, it cites it, and the UI only mirrors it for a better experience.

**How to read the criteria.** Each one ends with where it is enforced:

- **[DB]:** a grant, an RLS policy, a check or a trigger. The database refuses the write whatever the client does,
  and a test in `packages/db/tests` proves it. These are already built unless marked _new_.
- **[API]:** the Fastify admin routes. Used for what the database can't know (sending email, generating tokens) and
  for checks that protect people from mistakes rather than protect data.
- **[UI]:** the admin app only, for the user's experience. Never a security boundary.

Example data here is fictional ("Partido Ejemplo A", "Criterio de ejemplo 2").

## 1. Roles

| Role             | Who, typically                         | In short                                                                     |
| ---------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `platform_admin` | One or two people for the whole system | Every tenant except reports; platform settings; review settings              |
| `country_admin`  | The chapter's coordinator              | Members, election status and freeze, methodology, policy texts, tenant theme |
| `editor`         | Volunteers who research the parties    | Elections, parties, criteria, sources, cell drafts, change proposals         |
| `reviewer`       | Volunteers who check others' work      | Approve and publish cells, reject, attest quotes                             |

ADR-0002 (Capabilities by role) is the full table. A user may hold several roles in a tenant, and roles in several
tenants. `platform_admin` is not a tenant role: it is a row in `app.platform_admins` (ADR-0002 §8). Editors,
reviewers and country admins all triage right-of-reply reports; platform admins never read them (PLAN P11).

Every role is invite-only and needs TOTP. Until a session has completed TOTP, the database sees `aal = 1` and every
member policy returns nothing (ADR-0002 §9).

## 2. Conventions for every screen

1. **Tenant from the path.** Tenant screens live under `/t/{tenant-slug}/…` and election screens under
   `/t/{tenant-slug}/e/{election-slug}/…`. The host never selects a tenant or grants anything. A tenant the user
   can't see is a 404. [DB: RLS; API]
2. **One transaction per action.** Every write runs in one `withActor` transaction, so a multi-step action (reject
   with a note, propose and approve a change) either happens entirely or not at all. [API]
3. **Database errors become clear messages.** `42501` (not allowed) → 403; `23001` (wrong state, stale version,
   election status, freeze window) → 409 with "reload"; `23514` (something missing) → 422 naming what is missing;
   `23505` (a slug or invitation already taken) → 409 on the field. The trigger messages are mapped to i18n keys;
   unknown ones show a generic message and go to GlitchTip without request bodies (ADR-0003 §7). [API]
4. **Localized fields** show one tab per locale the tenant enables, the default locale first and marked required
   where publishing will need it. [UI]
5. **Ratings look the same as on the public site:** icon, text and colour, never colour alone. Party colours are
   never used to show a rating. [UI]
6. **Accessibility:** WCAG 2.2 AA, axe in CI, keyboard-complete forms and dialogs (Ark UI). [UI]
7. **UI language:** the admin is in Spanish or English (the browser's choice, with a switch). Content is entered per
   locale regardless of the UI language. [UI]

## 3. Access

### A1. The first platform admin

_As the owner, I create the first platform admin without an invitation, because sign-in is invitation-only._

1. A command in `apps/api` (`bootstrap:platform-admin --email <address>`) creates the account with the email marked
   verified and no password, adds the `app.platform_admins` row, and prints a single-use link to set a password,
   valid for one hour. [API]
2. The command needs the owner's database connection. Under any runtime role it fails, because no runtime role can
   write `app.platform_admins`. [DB: no grant]
3. The link is printed once and never logged. Its token travels in the query string (ADR-0003 §7). [API]
4. Adding further platform admins and removing them is the same owner-only command. Each change is audited. [DB:
   audit trigger on `platform_admins`]
5. In the admin, a platform admin sees the list of platform admins and can't change it. [DB: RLS, no write grant]

### A2. Invite a member

_As a country admin, I invite someone with a role, so that only people we vetted have accounts._

1. Only the tenant's country admins and platform admins create, see, revoke and delete invitations, since they hold
   emails. [DB: RLS on `invitations`]
2. The API generates a random 32-byte token, stores only its SHA-256, and emails the link through Mailu. [API; DB:
   `token_hash` format]
3. An invitation expires after 7 days. The database refuses more than 30. [API default; DB: check]
4. Inviting the same email to the same tenant and role again revokes the pending invitation and sends a new one. [API]
5. Inviting someone who already holds that role in the tenant is refused with a clear message. [API; DB: membership
   primary key]
6. Country admins revoke pending invitations, and delete accepted, revoked or expired ones so emails aren't kept
   longer than needed. The audit log never holds the email. [DB: RLS, transition trigger, personal-data comment]

### A3. Accept an invitation

_As an invited volunteer, I follow the link and end up with an account and my role._

1. The link opens the acceptance page on the admin host. An unknown, expired, revoked or used token gets one generic
   message, so the page reveals nothing about the invitation. [API]
2. If no account has the invited email, the person sets a password (A5) and the account is created with that email
   verified, since following the link proves the address, and the invitation is accepted at once (3). [API]
3. If an account already has that email, the person signs in first. Either way, `private.accept_invitation(token)`
   accepts only if the user's verified email is the invited one. [DB: _new_ `accept_invitation`, on the ADR-0002
   allowlist]
4. Accepting creates the membership and marks the invitation accepted once, with the time and the user taken from
   the session. [DB: `invitation_transition`]
5. A new account goes straight to TOTP enrolment. The membership grants nothing until TOTP is done, because every
   policy helper requires `aal = 2`. [API; DB: `my_tenants`]

### A4. Sign in

_As a member, I sign in with a password and a second factor._

1. Sign-in is email and password, then a TOTP code or a backup code. There is no self sign-up. [API: Better Auth]
2. A session without TOTP reaches only the enrolment and challenge pages, and the database gives it nothing. [API;
   DB: `aal`]
3. Enrolment shows a QR code and the secret, needs one valid code to finish, and then shows ten backup codes once.
   [API]
4. TOTP is asked at every sign-in; there are no remembered devices. A session ends 12 hours after sign-in, or at
   sign-out. [API]
5. Failed attempts are rate limited. [API: Better Auth's limiter]
6. The session cookie is host-only (`__Host-`), `Secure`, `HttpOnly` and `SameSite=Lax`, on the admin host only. The
   public site never sets a cookie. [API; ADR-0002 §15]

### A5. Passwords and lost factors

1. Passwords have at least 12 characters. [API]
2. "Forgot password" emails a single-use reset link valid for one hour. The page answers the same whether or not the
   email has an account. [API]
3. A reset changes only the password: TOTP stays, and the user's other sessions are revoked. [API]
4. A lost authenticator with no backup codes is reset with the owner-run command of A1 (ADR-0002 §10). It removes the
   user's TOTP and sessions, and they enrol again at their next sign-in. [API]

### A6. Choose a tenant

1. After sign-in, a user with one tenant lands on its dashboard; a user with several, or a platform admin, lands on
   a tenant list. [API; DB: RLS on `tenants`]
2. Platform admins see every tenant; everyone else sees only their own, and nothing of other tenants, not even
   published content (PLAN, Answered: admin visibility). [DB: RLS]

### A7. Manage members

_As a country admin, I see who has access and remove access that is no longer needed._

1. Every member sees the tenant's members, with names and roles. Emails are shown only to country admins and
   platform admins. [API]
2. Country admins and platform admins remove a role. Giving an existing member another role is direct; anyone else
   needs an invitation. [DB: RLS on `memberships`; API]
3. A removal takes effect on the member's next request, because policies read memberships in every statement. [DB]
4. The tenant's last country admin can't be removed from the admin; a platform admin would have to add another first.
   [API]
5. A platform admin who adds a membership, including to themselves, is audited, and the tenant's country admins see
   it in the audit view (PLAN P11). [DB: audit trigger]

## 4. Platform administration

The pilot has one tenant, created by the owner. M2 gives platform admins only what the pilot needs in the admin; the
rest stays a runbook (W6).

### P1. Review settings

1. Only platform admins turn an election's `require_second_reviewer` on or off, and a tenant's
   `live_edits_need_second_approver`. Both changes are audited. [DB: `restrict_columns`, `members_may_change`, audit]
2. Turning four-eyes off asks for confirmation and says what it means: one person may then publish their own work,
   which is recorded privately as self-reviewed. [UI]
3. Every member sees both settings on the election and tenant screens. [UI]

### P2. Organizations

1. Only platform admins write organizations: display name, legal name, NIF, address, registry entry, contact and
   privacy emails, URL, logo and `is_pauseai_chapter`. [DB: RLS]
2. Emails are stored lowercase and checked; the URL must be `https://`. [DB: checks]
3. Platform admins link endorsers to a tenant. Changing a tenant's operator stays a runbook (W6). [DB: RLS on
   `tenant_organizations`]
4. A change updates every page that shows the organization, the legal notice included. [DB: `bump_public_version`]

### P3. Brand assets

1. Platform admins upload PNG, JPEG or WebP images up to 2 MB. SVG is refused, since it can carry script. [DB: check]
2. They mark an asset restricted and grant it to tenants. A tenant may use a restricted asset only while its
   operator is a PauseAI chapter and it holds a grant. [DB: deferred eligibility trigger]
3. A grant can't be revoked while the tenant uses the asset: the tenant's selection changes first. [DB: same]

## 5. Tenant settings

_As a country admin, I set up how my tenant looks and what it says about us._

### T1. Theme and logos

1. Country admins set the theme's named colours. The database accepts only `#rrggbb` values under lowercase names;
   the API refuses a colour that fails WCAG AA contrast with the text it is paired with. [DB: `theme_is_colours`;
   API]
2. Which names exist is the public-site spec's (M3). [UI]
3. Country admins upload the tenant's logos (PNG, JPEG or WebP, into its public assets) and assign each to a slot:
   the operator's logo for orange, white and dark surfaces, and its mark. Logos are the tenant's data, never code.
   [DB: `brand_file_is_public_asset`, one source per slot; API: image size; UI]
4. They may also upload the site icon (the `site_icon` slot): a whole, square PNG of 512 to 1,024 pixels a side. The
   upload screen refuses anything else, with the same check as the public site, which would show the platform's
   default icon instead (PLAN R72). [UI; web]
5. A slot can instead take a platform brand asset from the catalogue. Restricted assets appear only when the tenant
   is eligible. [DB: eligibility trigger; UI]

### T2. Policy texts

1. Country admins write the privacy policy, the right-of-reply policy and the text about the operator, in Markdown
   per locale. [DB: RLS on `tenant_documents`]
2. Publishing needs the default locale. A published version never changes; the next version starts as a copy of
   the latest one. [DB: `tenant_document_rules`; UI]
3. Drafts can be deleted; published versions stay as history. [DB: RLS]

### T3. Report retention

1. Country admins set how many days reports are kept before they are anonymized (PLAN Q7). [DB:
   `members_may_change`]
2. The screen says it applies to reports sent from then on, since each report's date is fixed when it arrives. [UI;
   DB: `submit_report`]

## 6. Elections

### E1. Create and edit an election

_As an editor, I set up an election so we can start preparing it in private._

1. Editors and country admins create elections. A new election is always a draft, with four-eyes on and no freeze
   window. [DB: column grants, `election_rules`]
2. Fields: name (per locale), slug, type, territory and date. A general or European election has no territory; a
   regional one needs one, inside the tenant's country. A slug can't look like a locale code. [DB: checks,
   `election_rules`]
3. While it is a draft, editors and country admins change any of these. [DB: RLS]
4. Once live, the slug, type and territory are fixed, and the name and date change only through a change request
   (CR1). [DB: `election_rules`, change control]

### E2. Methodology

1. Country admins write the election's one methodology. Its kind is the tenant's and is shown, not chosen. [DB:
   `structure_rules`]
2. A `demands` methodology names the organization whose demands it uses: the operator or an endorser. [DB: check,
   `structure_rules`]
3. The body is Markdown per locale, sanitized when rendered. [UI; web]
4. The source kinds that may back a rating, and those that may back "No lo menciona", default to PDFs and web pages
   until the chapter decides (PLAN Q9). [DB: defaults]
5. When a kind is removed, the screen says how many existing quotes or checked documents use it. Those cells can't be
   submitted or published until fixed. [UI; DB: evidence rules, publish trigger]

### E3. External reviewers

1. Country admins add the methodology's named external reviewers: name, affiliation and order. [DB: RLS]
2. The form asks the country admin to confirm the person agreed to be named publicly (W10). [UI]
3. Names are personal data and never reach the audit log. [DB: column comment, audit trigger]
4. In a draft election, external reviewers are edited and deleted directly. Once it is live, they are added, changed
   and retired through change requests. [DB: RLS, change control]

### E4. Parties and criteria

1. Editors and country admins add parties: name and short name (per locale), slug, display order, colour, website,
   logo and territories. [DB: RLS, checks]
2. A party logo is an image in the `public_assets` bucket, never a source document. The API also limits logos to
   1 MB. [DB: `party_logo_is_public_asset`; API]
3. Party territories must be inside the tenant's country. [DB: `structure_rules`]
4. Editors and country admins add criteria: title, short title and description (per locale), slug, order, and
   optionally a core criterion. The short title heads the criterion's column in the public table, so the form shows
   it at that width (W22). [DB: RLS; `short_title` is _new_]
5. Lists can be reordered by drag and by keyboard. [UI]
6. Once live, both change only through change requests (CR1), except a party's programme status (PS1). [DB]

### E5. Go live

_As a country admin, I make the election public. Every cell without a published rating shows as pending._

1. Only country admins and platform admins change an election's status. [DB: `restrict_columns`]
2. A checklist mirrors the database's conditions: an active tenant, an operator, a methodology, and default-locale
   text for the election's name, the methodology, every party's names and every criterion, short title included.
   [UI; DB: `election_rules`]
3. It also warns, without blocking, about an election with no parties or no criteria, a methodology with no external
   reviewers, and unpublished policy texts (W9, O3). [UI]
4. Going live can't be undone, so the dialog asks the user to type the election's slug. [UI; DB: transitions]
5. `went_live_at` is stamped, and the election, its structure and its published revisions become public. [DB]

### E6. Freeze window

1. Country admins set the window's start, and an end or none (frozen until cleared), and clear it. [DB:
   `restrict_columns`, check]
2. Inside the window nothing public changes: no publishing, no change-request approval, no programme status. [DB:
   publish trigger, change control, programme rules]
3. Drafting, reviewing and comments go on. Every election screen shows a banner with the window. [DB; UI]

### E7. Archive

1. Country admins archive a live election after the results. It can't be undone, and the dialog says what stays
   possible. [DB: transitions; UI]
2. Afterwards the election and its structure are read-only. Corrections and withdrawals of published cells, new
   sources for them, and report handling continue (PLAN P16). [DB: `election_rules`, `structure_rules`,
   `assessment_trail`]

### E8. Delete draft structure

1. Only drafts are deleted: elections, methodologies and external reviewers by country admins; parties and criteria
   by editors and country admins. [DB: RLS]
2. Anything that still references the row (cells, sources) must go first. The screen lists what blocks the delete.
   [DB: foreign keys; UI]

## 7. Sources

_As an editor, I store each party document we cite, so quotes are checked against the exact bytes we keep._

### S1. Add a source

1. Editors and country admins add a source: kind, title as published, URL, language, its party (or none, for a
   party-neutral document) and whether it is the party's programme. Only a party's source can be its programme. [DB:
   RLS, checks]
2. Until a copy is stored, all of these can be edited. Afterwards the source never changes, except its extraction
   status (once, from pending) and its archive URL (once). A wrong source is replaced, not edited (S5). [DB:
   `source_document_rules`]
3. Sources can still be added to an archived election, for corrections. [DB]

### S2. Store a copy

1. **By URL:** the API requests a fetch job; only the worker fetches, never the API (hostile files, threat A8). The
   copy is attached once, as fetched. [DB: `job_request_rules`, `worker_job_scope`]
2. **By upload:** the editor uploads the file into the `sources` bucket, up to 50 MB. The same bytes are stored once
   per tenant, so a second upload reuses the first file. [DB: checks, unique hash; API]
3. Before an upload, the screen says that the uploader counts as a contributor of every cell that cites the file,
   so they can't publish those cells while four-eyes is on. [UI; DB: publish trigger, step 4]
4. The file store computes the bytes' hash as it stores them, in the tenant's `sources` bucket, and checks it again
   whenever they are read (ADR-0004). The database sets the source's hash, from its file's row, and the time its copy
   was stored; neither comes from the client. [API: file store; DB: `source_document_rules`]

### S3. Extract the text

1. Once a copy is stored, the API requests extraction on behalf of the member who stored it (W11). [API; DB: job
   rules]
2. PDFs are extracted page by page with PDF.js, and web pages section by section with Readability (ADR-0003 §9). [API:
   worker]
3. The status goes from pending to done, failed or not applicable (kinds without text, or a scan with no text
   layer), once. The text is written only while pending and never changes. [DB: `source_text_rules`, transitions]
4. A source is citable once it has a stored copy and its extraction is done or not applicable. The list shows each
   source's state and whether it is citable. [DB: evidence rules; UI]
5. A failed extraction isn't citable: the editor replaces the source (S5). A scan with no text layer is marked not
   applicable, and its quotes go through the attested path (C4). [DB; UI]

### S4. Archive a snapshot

1. For a source with a URL, the API requests an archive job; the archive URL is set once (O1). [DB: job rules,
   `source_document_rules`]
2. A missing snapshot is a warning on the source and in review, not a block (W12). [UI]

### S5. Replace or delete a source

1. Replacing a source is adding the right one, moving each quote to it (a content change of each cell, so it goes
   back through review), and deleting the old one. [DB: evidence rules; UI]
2. A source is deleted only while nothing cites it; an uploaded file only while nothing references it. [DB: foreign
   keys, `files` rules]

### S6. Read a source

1. Members open the stored copy in the admin's PDF.js viewer. Matched quotes are highlighted from the same text layer
   the extraction used, so the viewer and the match can't disagree (ADR-0003 §9). [UI]
2. The extracted text is never public (copyright, PLAN P8). [DB: no `aiontheballot_web` grant]

## 8. Cells

A cell is one party × criterion assessment. Its working copy is private; the public sees only published revisions.

### C1. The cell grid

1. Each election has a grid with parties down the side and criteria across the top, as in the public table. Each
   cell shows its working state (none, draft, in review, published, published with a newer draft), the current
   published rating as icon, text and colour, and flags: rejected with a note, recheck needed. [UI]
2. Queues on the tenant dashboard: my drafts, drafts returned to me, cells awaiting review that I didn't work on,
   recheck flags, pending change requests, new reports, sources that failed. [UI]

### C2. Draft a rating with quotes

_As an editor, I write a rating backed by verbatim quotes, and see at once whether each quote matches its source._

1. Editors and country admins create a cell; it starts as a draft. [DB: RLS, `assessment_trail`]
2. The rating comes from the tenant's scale only: _Cumple_, _Cumple parcialmente_, _No cumple_, _No lo menciona_
   for `demands`. [DB: `assessment_trail`; UI]
3. The summary is written per locale; the default locale is needed to submit. [DB]
4. A quote cites a citable source of the cell's party, or a party-neutral one, of a kind the methodology admits. [DB:
   `evidence_rules`]
5. A quote has 15 to 1,000 characters, and at least 15 after normalization. [DB: check, `evidence_rules`]
6. As the editor types, the cell editor shows whether the quote matches and on which pages ("p. 47–p. 48"), or that it
   doesn't, with the longest matching part highlighted to help find the difference (W13). [API; UI]
7. On save, the database computes the match itself; a status sent by the client is ignored. If the two ever
   disagree, the database wins and the difference is reported as an error. [DB: `evidence_rules`; API]
8. The public sees the matched pages' labels, never a page an editor typed. The page field is a hint only. [DB:
   publish trigger]
9. Quotes are always shown exactly as stored; normalization is for matching only. [UI]

### C3. "No lo menciona"

1. A "No lo menciona" rating needs at least one checked document: a stored copy of one of the party's own
   documents, of a kind the methodology lists for it. [DB: `checked_document_rules`, submit and publish checks]
2. The time each document was checked is set by the database. Checking it again is removing and adding it. [DB:
   stamp, primary key]
3. It may be given before the party's programme exists (PLAN P15). [DB]

### C4. Attested quotes

_For a source without text (a social post, a video, a scan), a second person confirms the quote._

1. The editor attaches a screenshot or clip from the `sources` bucket, and for video or audio the start and end in
   seconds. [DB: `evidence_rules`; UI]
2. A different member attests. The quote's author may attest only when a platform admin has turned four-eyes off for
   the election. [DB: `evidence_rules`]
3. A quote from a source with text is matched, never attested. [DB]
4. Any change to the quote undoes its attestation. An attester withdraws theirs before someone else attests. [DB]
5. Attesting is not a contribution, so the attester can still publish the cell; uploading the attestation file is.
   [DB: content trigger, publish trigger]

### C5. Submit for review

1. Editors and country admins submit a draft. Reviewers don't. [DB: `assessment_transition`]
2. The database refuses a submission without: a rating (unless withdrawing), a summary in the default locale, the
   evidence the rating needs, every quote matched or attested from an admitted kind, and after the first publish a
   change kind and a public note in the default locale. The cell editor shows the same checklist as it fills. [DB:
   `assessment_trail`, `submitted_evidence_rules`; UI]
3. Cells may be submitted in a draft election, so the work can be reviewed before going live; they are published
   only once it is live (PLAN R6). [DB]
4. In review, the content is locked. [DB: `assessment_transition`]

### C6. Recall

1. Anyone who contributed to the current draft recalls it from review to edit it again. The trail records
   "recalled". [DB: `assessment_transition`, `assessment_trail`]

### C7. Review and publish

_As a reviewer, I check someone else's draft against its sources and publish it._

1. Reviewers, country admins and platform admins publish. They must have completed TOTP. [DB: publish trigger, step 3]
2. While the election requires a second reviewer, nobody who edited the draft or uploaded a file it cites can
   publish it. The Approve button is replaced by the reason. [DB: publish trigger, step 4; UI]
3. With four-eyes off, the dialog warns that publishing one's own work is recorded as self-reviewed. [UI; DB:
   `revision_internal`]
4. The review screen shows the draft next to the current published revision, every quote highlighted in its source,
   each match status, the checked documents, the change kind and note, and who contributed. [UI]
5. Approving publishes the version the reviewer saw. If the draft changed meanwhile, publishing is refused and the
   screen reloads. [DB: publish trigger, step 1]
6. Publishing needs a live election (or an archived one, for corrections and withdrawals) and no freeze window. [DB:
   step 2]
7. The database checks the evidence and the verbatim match again at publish time, whatever was checked before. [DB:
   steps 6–7]

### C8. Reject

1. Reviewers, country admins and platform admins who didn't edit the draft reject it with a note. The note is a
   comment written in the same transaction, which the trail copies into the "rejected" event. [DB:
   `assessment_transition`]
2. The cell goes back to draft, and its editors see the note on the cell and in their queue. [DB; UI]
3. A reviewer who rejected a cell can approve it once fixed. [DB: rejecting isn't a contribution]

### C9. Comment

1. Any member comments on a cell at any time. Comments are never edited or deleted. [DB: RLS, immutability]

### C10. Update or correct a published cell

1. Editing a published cell starts a new draft; the public keeps seeing the last revision until the next one is
   published. [DB: `assessment_transition`]
2. The draft needs a change kind and a public note before it can be submitted. The screen explains the choice: a
   **correction** when what was published was wrong; an **update** when the facts changed, such as a new programme
   (W21). [DB: `assessment_trail`; UI]
3. Every revision after the first appears in the election's corrections log with its note. [DB:
   `app.corrections_log`]
4. When a correction comes from a right-of-reply report, the editor links the report in the draft (W14). [DB: _new_
   column; UI]

### C11. Withdraw a rating

1. Withdrawing is a draft with the change kind "withdrawal", no rating and a public note, reviewed like any other.
   [DB: `assessment_trail`, publish trigger]
2. Only a published cell is withdrawn; one never published is deleted instead (C13). [DB: `assessment_trail`]
3. Once published, the cell shows as withdrawn, which is not the same as pending. [DB: `current_revisions`]

### C12. Recheck flags

1. When a party's programme is marked published, each of its cells whose current rating is "No lo menciona" is
   flagged for a recheck. [DB: `programme_recheck`]
2. Editors and country admins clear the flag once they have checked. Clearing it isn't a content change, so it
   doesn't reopen review; it is audited (W19). [DB: `restrict_columns`, audit]

### C13. Delete a cell

1. Editors and country admins delete a cell that was never published, with its quotes and checked documents. [DB:
   RLS]
2. Once it has a review trail, it stays as a draft instead (PLAN R5). [DB: foreign keys]

### C14. Two people on one cell

1. Each save of a quote or field is its own change. If someone else changed the cell since it was loaded, the screen
   says so and offers to reload before saving. [API: `content_version`; UI]

## 9. Programme status

### PS1. Set the programme status

_As an editor, I record whether each party has published its programme, and when we last checked._

1. Editors and country admins set a party's programme to pending or published, directly, even once the election is
   live. [DB: grants, `programme_rules`]
2. Every update, even to the same value, records the check date, which the public sees ("comprobado el …"). The
   screen has a "Checked now" action for that. [DB; UI]
3. "Published" needs a source of the party marked as its programme. [DB]
4. It is refused in an archived election and inside a freeze window, and it is audited. [DB]

## 10. Change requests (live elections)

### CR1. Propose and decide a change

_As an editor, I propose a fix to a live election's structure; the change and its reason become public._

1. In a live election, change-controlled fields are read-only. Next to each, "Propose a change" asks for the new
   value and a public note. [UI; DB: change control]
2. Change-controlled are the election's name and date; the methodology's demands owner, body and source kinds; and
   every column of external reviewers, parties and criteria except slugs and the programme status. Parties, criteria
   and reviewers are added and retired the same way. [DB: `change_request_rules`]
3. Editors and country admins propose. The previous value is read from the target, never from the client. [DB]
4. Country admins and platform admins approve. Approving applies the change in the same transaction and writes its
   public record. Reviewers may reject but are not offered Approve, since they can't write structure (PLAN R24, W16).
   [DB: approval trigger; UI]
5. When the tenant requires a second approver, the proposer can't approve their own request. Otherwise the screen
   offers "Propose and apply" in one step. [DB: `decided_by <> proposed_by`; API]
6. Approval is refused if the target changed since the proposal (propose again), inside a freeze window, or without
   default-locale text in the note and in any new text. [DB]
7. A decided request never changes. A pending one may be withdrawn by an editor or country admin. [DB: PLAN R28]
8. Each approved change appears in the corrections log. A request prompted by a report may link it. [DB]

## 11. Records

### H1. History

1. Every member sees a cell's revisions with their dates, and privately who contributed, who published, and whether
   it was self-reviewed. [DB: RLS on revisions and `revision_internal`]
2. The review trail (submitted, recalled, rejected with note, approved, comments) is shown in order. [DB:
   `review_events`]
3. A diff between the draft and the published revision, or between two revisions. It is admin polish, on the cut
   list (PLAN, item 5). [UI]
4. The election's corrections log, as the public will see it. [DB: `app.corrections_log`]

### H2. Right-of-reply reports

_As a member, I triage what the public reports, and link the corrections it leads to._

1. Editors, reviewers and country admins see their tenant's reports; platform admins never do (PLAN P11). [DB: RLS]
2. A report goes from new to triaged, then accepted, rejected or spam, each once. Who triaged it and when are
   recorded. Anyone who can triage may mark spam, from triaged (W15). [DB: report rules]
3. The resolution note is internal. The report's own contents never change. [DB]
4. An accepted report shows the corrections and change requests that link it. Accepting doesn't need a link yet,
   since a correction may still be in review (W14). [UI]
5. Country admins anonymize a report on request, which removes every personal field at once. The worker does the same
   when the retention period ends. [DB: report rules, `anonymize_expired_reports`]
6. Report contents never reach the audit log or error reports. [DB: personal-data comments; API: Sentry scrubbing]

### H3. Audit view

1. Country admins see their tenant's audit log; platform admins see all of it. [DB: RLS]
2. Each entry shows who, when, what table and row, and what changed. Personal data is never in it. [DB: audit
   trigger]
3. Filters by actor, table, row and time. Actors are shown by name. [UI; API]

## 12. Public cache

### PC1. Changes reach the public site

1. Every write to a public-capable table moves the tenant's public version: a publish, an approved change, a
   programme status, going live, a published policy text, an organization or brand change. [DB:
   `bump_public_version`]
2. After the transaction commits, the API asks each web replica to revalidate. A version check at most every 60
   seconds is the safety net, so every change is public within 60 seconds (ADR-0003). [API; web]

## 13. Screens

1. **Access:** sign in, TOTP challenge, TOTP enrolment with backup codes, forgotten password, invitation acceptance.
2. **Tenant list** (users with several tenants, platform admins).
3. **Tenant dashboard:** the queues of C1.
4. **Members and invitations.**
5. **Tenant settings:** theme, logos, policy texts, report retention.
6. **Elections:** list; overview with status, go-live checklist, freeze window, archive and review settings.
7. **Methodology** and its external reviewers.
8. **Parties** and **criteria:** ordered lists and forms, with programme status on parties.
9. **Sources:** list per election with states; detail with the viewer.
10. **Cell grid**, **cell editor** (with the source viewer beside it) and **review screen**.
11. **Change requests:** the propose dialog from any change-controlled field; the list and decision screen.
12. **History:** cell history, corrections log.
13. **Reports:** queue and detail.
14. **Audit log.**
15. **Platform:** organizations, brand assets and grants (review settings live on the election and tenant screens).

## 14. Not in M2

- LLM suggestions (M4) and the MCP server (later). Evidence written in M2 is `manual`.
- Creating tenants, hostnames and their DNS verification, changing a tenant's operator, core criteria and platform
  admins in the admin: runbooks for the pilot (W6).
- Bulk editing and theming beyond logo and colours (PLAN, cut list 5).
- Notification emails (W17), passkeys (ADR-0003 §2) and changing a user's email.

## 15. How the M2 demo maps to this spec

| Demo (PLAN M2)                                                               | Criteria     |
| ---------------------------------------------------------------------------- | ------------ |
| Two users take a cell from draft to published                                | C2, C5, C7   |
| Self-review is rejected while the election requires a second reviewer        | C7.2         |
| A missing quote is rejected                                                  | C5.2, C7.7   |
| A quote that doesn't match its source is rejected                            | C2.6–7, C5.2 |
| Editing a live criterion needs an approved change request with a public note | CR1.1–6      |
| … and a second person when the tenant requires one                           | CR1.5        |

## 16. Before M2 starts

1. This spec reviewed.
2. The extraction spike against real programme PDFs from the chapter, kept outside the repository (ADR-0003 §9).
3. Better Auth's tables in the `auth` schema with uuid ids, or the fallback (data model, open item 2), and O2.
4. A migration for `criteria.short_title` (W22).

## 17. Decisions to review

Taken while drafting; each can be changed before M2 starts.

- **W1. The first account** is created by an owner-only command that prints a one-hour password-setup link, rather
  than a seeded password or an invitation without a tenant. Removing platform admins and resetting a lost
  authenticator use the same command.
- **W2. Invitations expire after 7 days** (the database allows up to 30). Inviting again replaces the pending one.
- **W3. A new account accepts its invitation when it is created,** before TOTP enrolment. That is safe because a
  membership grants nothing until the session has completed TOTP.
- **W4. Sessions:** TOTP at every sign-in, no remembered devices, 12 hours at most.
- **W5. Passwords** of at least 12 characters; a reset keeps TOTP and revokes other sessions.
- **W6. Platform-admin screens in M2** cover review settings, organizations, brand assets and grants, and members in
  any tenant. Tenants, hostnames, operator changes, core criteria and platform admins stay runbooks: rare for the
  pilot, and hostnames need a gitops change anyway.
- **W7. The last country admin** can't be removed in the admin (an API check, not a database rule).
- **W8. Structure forms in a draft election are last-write-wins:** those tables have no version column, and the
  audit log records every change. Cells use `content_version`.
- **W9. The go-live checklist warns** about missing parties, criteria, external reviewers and policy texts, but
  only the database's own conditions block (see O3).
- **W10. Consent of external reviewers** is a confirmation in the form, not stored.
- **W11. Source jobs are chained by the API,** not the worker, which can't request jobs by design: extraction and
  archiving are requested in the upload's transaction, and after a fetch when a member next opens the source (or
  presses "Continue"). The alternative, letting the worker request the next job as the requester, is a new grant
  and an ADR-0002 update.
- **W12. A missing archive snapshot doesn't block** citing or publishing; it is a warning.
- **W13. Live match feedback runs in the API,** with the TypeScript port of the normalizer that is tested on the
  same fixtures as the database function. The browser sends the quote and gets the match back; the database decides
  on save.
- **W14. Linking a report to a correction** (PLAN R22): a new `assessments.draft_report_id` column, part of the draft
  and reviewed with it. The publish trigger copies it into `revision_internal.report_id`, and the next draft starts
  without it. The link stays private. Change requests already have `report_id`. This is an M2 migration and a change
  to the publish trigger, reviewed line by line.
- **W15. Spam** (data model, open item 9): anyone who triages may mark a report as spam, from triaged, as today
  (PLAN R16). No reviewer is needed.
- **W16. Change-request approval** is offered to country admins and platform admins only; reviewers may reject.
  This follows PLAN R24 rather than giving reviewers structure rights.
- **W17. No notification emails in M2.** The dashboard queues show what waits for whom. Email is for invitations and
  password resets only (ADR-0001).
- **W18. Member emails** are shown to country admins and platform admins only; everyone sees names.
- **W19. Clearing a recheck flag** is not a content change, so it doesn't send a published cell back to review.
- **W20. Rejecting a change request** has no note: the table has no column for one, and the request itself is
  private.
- **W21. Correction or update** is the editor's choice, with guidance on screen; the reviewer checks it like the rest
  of the draft.
- **W22. Criteria get a short title** (`criteria.short_title`, localized, like parties' `short_name`), because the
  public table always puts parties down the side and criteria across the top (decided by Dani; PLAN, Answered). It
  is change-controlled once live like the rest of the criterion, and going live needs it in the default locale.

## 18. Open questions for Dani

- **O1. Archive service.** Which service takes the snapshots? Default: the Internet Archive's Save Page Now (free,
  public, sometimes slow or refused). Alternatives: archive.today, or no external snapshot (our stored copy and its
  hash only).
- ~~**O2. Better Auth's database role.**~~ **Decided:** a fourth role, `aiontheballot_auth`, that owns nothing and
  can reach only `auth.*`, so the admin role never sees password hashes or TOTP secrets (ADR-0002 §2).
- **O3. Should going live require at least one party and one criterion in the database?** A live election with
  none would be an empty public page. Recommendation: yes, as a small migration adding to `election_rules`.
- **O4. Team size.** With one or two people, four-eyes blocks publishing whenever one is away (PLAN P14). Who will
  review in the pilot? The answer decides whether a platform admin turns four-eyes off for the election.
