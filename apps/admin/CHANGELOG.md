# @aiontheballot/admin

## 0.30.3

### Patch Changes

- 5e3e7a7: From the security audit (PLAN R208). The API answers a fault as `unexpected`, never with its message, reports it
  once, by its code, and answers an unknown route under `/api` with its own headers. The error relays refuse what a
  browser marks as sent from any other origin, and the admin's chart can limit its relay per address, as the web chart
  does. The share images take fflate 0.7.5, which fixes an advisory in code they never call. The migrations image is
  unchanged, rebuilt only because the shared lockfile changed.
- Updated dependencies [5e3e7a7]
  - @aiontheballot/observability@0.2.7
  - @aiontheballot/og@0.7.3

## 0.30.2

### Patch Changes

- 6bc197c: Rebuilt only because the shared lockfile changed (the API's image dropped the authentication library's optional
  peers); this image is unchanged.

## 0.30.1

### Patch Changes

- e1010f7: Comments, chart notes and examples describe what the platform needs from its host, never the host itself (PLAN
  R205): the deployment's specifics stay in the operator's private configuration. No behaviour changes.
- Updated dependencies [e1010f7]
  - @aiontheballot/observability@0.2.6

## 0.30.0

### Minor Changes

- 8bf6d1e: A member's tokens for tools, in the API and the admin (PLAN R203, ADR-0008): a tool's request with a token acts as
  its member on the routes that draft an election's parties, and on no other; the admin's "Tokens for tools" page
  creates one (shown once), lists them and revokes them.

### Patch Changes

- Updated dependencies [8bf6d1e]
  - @aiontheballot/i18n@0.28.0

## 0.29.1

### Patch Changes

- 1ffae74: Dependencies bmp
- Updated dependencies [1ffae74]
  - @aiontheballot/domain@0.14.1
  - @aiontheballot/i18n@0.27.4
  - @aiontheballot/observability@0.2.5
  - @aiontheballot/og@0.7.2

## 0.29.0

### Minor Changes

- 31b4f06: Territories are chosen by name from the site's country's subdivisions (ISO 3166-2, the pinned `iso-3166` package):
  ticked for a party, in its form and in a change request, and selected for an election. A country with none listed
  keeps the code field (PLAN R201).

### Patch Changes

- Updated dependencies [31b4f06]
  - @aiontheballot/i18n@0.27.3

## 0.28.0

### Minor Changes

- 6164fb1: The invitation page names the site it invites to: the database's lookup of a pending invitation also returns its
  site's display name and main language (PLAN R199, ADR-0002 §10 amended).

### Patch Changes

- Updated dependencies [6164fb1]
  - @aiontheballot/i18n@0.27.2

## 0.27.1

### Patch Changes

- a232017: On a phone, each row of the admin's sections is one line that scrolls sideways, brought to the current section, and
  the text buttons are 44 px tall; a published cell opens behind a "Correct or update it" step (PLAN R197, admin forms
  step 10).
- Updated dependencies [a232017]
  - @aiontheballot/i18n@0.27.1

## 0.27.0

### Minor Changes

- 83137c3: Clip times are written as minutes and seconds; a report can be decided at once, its choices explained; a new site's
  country is chosen by name; the methodology and legal texts show a preview rendered as the public site renders them,
  whose renderer now lives in the domain package (PLAN R196, admin forms step 9).

### Patch Changes

- Updated dependencies [83137c3]
  - @aiontheballot/domain@0.14.0
  - @aiontheballot/i18n@0.27.0
  - @aiontheballot/og@0.7.1

## 0.26.0

### Minor Changes

- 0038242: A site's country admins set its logos and icon from its settings, one image per slot, which the public site serves at
  once; platform admins set an organization's logo, kept among the platform's images, and change a site's name, other
  languages and operator from its page (PLAN R195, admin forms step 8).

### Patch Changes

- Updated dependencies [0038242]
  - @aiontheballot/i18n@0.26.0

## 0.25.0

### Minor Changes

- b102dd1: A source's copy can be chosen when the source is added (a file, or fetched from its address) and is stored right after
  it; files are chosen in a field that shows each one's name, size and type; a source's language is chosen by name; and
  its page shows its details once, with an "Edit" button (PLAN R194, admin forms step 7).

### Patch Changes

- Updated dependencies [b102dd1]
  - @aiontheballot/i18n@0.25.0

## 0.24.0

### Minor Changes

- 93687c9: An election's overview starts with its status, next step and linked checklist; its settings are switches that save as
  they are switched; the freeze names the reader's time zone; archiving asks for the address name typed; and a draft's
  delete says why it can't be done yet rather than failing (PLAN R193, admin forms step 6).

### Patch Changes

- Updated dependencies [93687c9]
  - @aiontheballot/i18n@0.24.0

## 0.23.0

### Minor Changes

- 1821b6f: The admin's forms share one pattern: the primary button first, "Saved." beside it, edits staying on the page and
  creations said where they land, destructive actions together last. The slug is one "Address name" field everywhere,
  which follows the name and shows the public address; the wording uses one term per thing and no internal jargon
  (PLAN R192, admin forms step 5).

### Patch Changes

- Updated dependencies [1821b6f]
  - @aiontheballot/i18n@0.23.0

## 0.22.1

### Patch Changes

- e6a1e9b: The invitations table and the audit log fit a phone: no sideways scroll at 390 px (PLAN R191, admin forms step 4).

## 0.22.0

### Minor Changes

- 0dd4cc8: The cell editor keeps the text being typed in its draft when the same page adds or removes a quote, rather than
  warning that someone else changed the cell; asks before a link leaves unsaved edits; and has one bar at the bottom of
  the window to save the draft and submit it for review, which saves first. Each change of a cell's content answers with
  the version it left the cell at (PLAN R190, admin forms step 3).

### Patch Changes

- Updated dependencies [0dd4cc8]
  - @aiontheballot/i18n@0.22.0

## 0.21.0

### Minor Changes

- 0cf0a92: Every admin form with fields says what is wrong at the field, in the page's language, and moves focus to the first;
  the browser's own bubbles and the generic "something is missing" banner are gone from them. The API names the field of
  a request its schema refuses (PLAN R189, admin forms step 2).

### Patch Changes

- Updated dependencies [0cf0a92]
  - @aiontheballot/i18n@0.21.0

## 0.20.0

### Minor Changes

- 1f79c8a: The admin lists the published "not mentioned" ratings whose checked documents have all since been replaced, on the
  election's overview and the party's page, and the cell editor warns about such a draft (D20, PLAN R187): warnings,
  never a refusal. The admin's corrections log links each cell by its id, as the cell pages take.

### Patch Changes

- Updated dependencies [5cbf267]
- Updated dependencies [1f79c8a]
  - @aiontheballot/i18n@0.20.0

## 0.19.1

### Patch Changes

- 77f1e8f: Sharing, data first: one "Compartir" panel under each election page's title, the data image first (square, portrait
  or story; to the phone's apps or downloaded) and the link second. The election page's link preview now shows every
  party's rating on every criterion, and the party, criterion and whole-table cards are redrawn in the same style; every
  data card carries its data's date and the site's address, with no totals and no ranking (PLAN R185).
- Updated dependencies [77f1e8f]
  - @aiontheballot/og@0.7.0
  - @aiontheballot/i18n@0.19.0

## 0.19.0

### Minor Changes

- 362ae1e: A party shows as its logo, without a frame, in a box of one size, or else as a rounded square of its colour, with
  its colour as a thin line under its name (under the logo beside a link, so it never reads as a second underline):
  on the site, its share images and the admin's party list, in place of the colour square (PLAN R184).

### Patch Changes

- Updated dependencies [362ae1e]
  - @aiontheballot/og@0.6.0

## 0.18.0

### Minor Changes

- f5ab992: A live election's party, criterion, reviewer, methodology or the election itself changes through one request for
  any of its fields at once, each shown beside what it is now, with one public note: proposed, reviewed and applied as
  one, and listed field by field in the change list and both corrections logs; a party's new logo is uploaded first
  (PLAN R183). The party form takes the logo, previewed before it is uploaded, also when creating a party; a new party
  has no colour until someone picks one; the party page shows its name and logo first and stays put after a save;
  the list shows each party's logo and what it still lacks. Invitations start on the editing role, and the
  organization form says which legal details only a site's operator needs.

### Patch Changes

- Updated dependencies [f5ab992]
  - @aiontheballot/domain@0.13.0
  - @aiontheballot/i18n@0.18.0
  - @aiontheballot/og@0.5.3

## 0.17.0

### Minor Changes

- d7e62ac: An election can go to preview before it goes live: its site's members see it in the admin's preview as the public
  will, and edit it as a draft, while the public sees none of it, read through a database role of its own (PLAN R181).

### Patch Changes

- e091b88: The end-to-end task passes the preview's database URL through, as CI sets it (PLAN R181).
- 1c8713b: A member's roles are set in one dialog, a box per role, instead of a form per row; the members page fits a phone
  (PLAN R182).
- Updated dependencies [d7e62ac]
- Updated dependencies [1c8713b]
  - @aiontheballot/domain@0.12.0
  - @aiontheballot/i18n@0.17.0
  - @aiontheballot/og@0.5.2

## 0.16.1

### Patch Changes

- 1578588: A party without a colour leaves a blank space beside its name instead of an empty square; a password link written
  just after an authenticator reset is forgotten rather than mailed (PLAN R180).
- Updated dependencies [1578588]
  - @aiontheballot/og@0.5.1

## 0.16.0

### Minor Changes

- 3854bad: Country admins choose their site's colour in Settings, and the public site and its share images take it, with the
  text that reads on it; parties' colours show beside their names on the share images (PLAN R178).

### Patch Changes

- 0df0472: Of two password links asked for one account at the same moment, exactly one is mailed, whatever order they were
  written in; the owner's reset of a lost authenticator also forgets the account's unused password links; "Mark as
  replaced" says it's done in the page's announcer (PLAN R179).
- 3d17625: A site's own colour keeps focus rings, borders and the coming-soon page's button visible on it, the public site
  checks a site's colours again as it loads them, and the colour form's reset and contrast ratio read right (PLAN R178).
- Updated dependencies [3d17625]
- Updated dependencies [3854bad]
  - @aiontheballot/domain@0.11.0
  - @aiontheballot/og@0.5.0
  - @aiontheballot/i18n@0.16.13

## 0.15.1

### Patch Changes

- 65392f7: The share-card invariants test allows a slow runner the time the reference test does; nothing drawn changes.
- Updated dependencies [65392f7]
- Updated dependencies [6efba86]
  - @aiontheballot/og@0.4.0
  - @aiontheballot/i18n@0.16.12

## 0.15.0

### Minor Changes

- e906c1e: Copies by URL and archive snapshots through a fetcher with no database login and no volume (ADR-0007, PLAN R175): a
  fetched copy is stored as the requester's upload, and the worker records each snapshot; off until gitops turns it on.

### Patch Changes

- Updated dependencies [e906c1e]
  - @aiontheballot/i18n@0.16.11

## 0.14.0

### Minor Changes

- 0cc4860: A site's members preview its public pages through the admin, sandboxed and script-free; the web app's preview host
  answers only with the shared token (ADR-0005, PLAN R174).

### Patch Changes

- Updated dependencies [0cc4860]
  - @aiontheballot/i18n@0.16.10
  - @aiontheballot/domain@0.10.4
  - @aiontheballot/og@0.3.14

## 0.13.14

### Patch Changes

- 7582557: A "replaced" mark on a source (PLAN R172, D14): set once by those who write sources, it keeps the source out of
  new quotes and checks and lists it last; what cites it stays.
- Updated dependencies [7582557]
- Updated dependencies [483ae64]
  - @aiontheballot/i18n@0.16.9
  - @aiontheballot/og@0.3.13

## 0.13.13

### Patch Changes

- 143bd63: Attested quotes in the cell editor (PLAN R171, C4): a screenshot or clip, and clip times, for a quote from a source
  without text, attested or withdrawn by another member at the version they read.
- ececa5c: Password recovery (PLAN R170): "I forgot my password" on the admin's sign-in page and "Send a password reset email" in
  Members, for whoever manages a site's members. A single-use link for an hour; the second factor stays, every session
  ends, and the account is told its password changed.
- Updated dependencies [143bd63]
- Updated dependencies [ececa5c]
  - @aiontheballot/i18n@0.16.8

## 0.13.12

### Patch Changes

- d93398f: A correction names the report it answers (PLAN D16): migration `draft_report_link` adds `assessments.draft_report_id`,
  which publishing copies into the revision's private record; the cell editor offers it after the first publish.
- Updated dependencies [d93398f]
  - @aiontheballot/i18n@0.16.7

## 0.13.11

### Patch Changes

- 02420fb: Turn off Next's image optimizer in both apps (PLAN R163): neither uses it, and `/_next/image` is now the not-found
  page instead of a fetch inside the server for every caller.
- 7c90561: The table image (PLAN R164) shows every column's header, also when it stands on end next to a narrow party column,
  and its rows and icons grow when there are few parties.
- Updated dependencies [7c90561]
  - @aiontheballot/og@0.3.12

## 0.13.10

### Patch Changes

- dd99189: The whole table as one image (PLAN R162): the scorecard's download dialog offers every party's rating on every
  criterion in the square, portrait and story sizes, drawn by a new share-card template.
- Updated dependencies [dd99189]
  - @aiontheballot/og@0.3.11
  - @aiontheballot/i18n@0.16.6

## 0.13.9

### Patch Changes

- 5587bfb: The admin shows ratings as the public sees them (icon, words and colour), work queues on each site's dashboard, and
  the checklist of what submitting a draft needs (PLAN R159).
- Updated dependencies [5587bfb]
  - @aiontheballot/i18n@0.16.5

## 0.13.8

### Patch Changes

- 3ac798b: Quotes picked from their source (PLAN R155): once a source is chosen in the cell editor, its extracted text shows
  beside the quote form, and a passage selected there fills the quote and its page. The database still matches the
  quote on save.
- Updated dependencies [3ac798b]
  - @aiontheballot/i18n@0.16.4

## 0.13.7

### Patch Changes

- 52f97ae: The admin has icons (PLAN R154): the platform's default site icon as /favicon.ico, a 32 px tab icon and the 180 px
  home-screen icon, drawn at build time by the share images' renderer.

## 0.13.6

### Patch Changes

- Updated dependencies [7083260]
  - @aiontheballot/domain@0.10.3

## 0.13.5

### Patch Changes

- 9224479: The corrections log and the records (PLAN R150): a public corrections log per election with its share card, the
  public data's approved structural changes, each revision's private record in the admin, the election's log in the
  admin, and the audit view for a site's country admins and for platform admins.
- Updated dependencies [9224479]
  - @aiontheballot/domain@0.10.2
  - @aiontheballot/i18n@0.16.3

## 0.13.4

### Patch Changes

- 3ba6bb4: The right of reply, end to end (PLAN R149): a public form under each election (no cookies, silent spam checks, limits
  per visitor and site), the API's intake as the public role, the admin's triage queue with internal notes and
  anonymizing, change requests that name the report they answer, and a daily CronJob that anonymizes reports past their
  retention.
- Updated dependencies [3ba6bb4]
  - @aiontheballot/domain@0.10.1
  - @aiontheballot/i18n@0.16.2

## 0.13.3

### Patch Changes

- Updated dependencies [3590ae1]
  - @aiontheballot/i18n@0.16.1

## 0.13.2

### Patch Changes

- c9a8060: The admin sends security headers (PLAN R145): a Content Security Policy with a nonce per response, HSTS, nosniff,
  a same-origin referrer policy, a permissions policy, COOP and no framing; the API's answers there are data only.
  The e2e suite fails on any CSP violation.

## 0.13.1

### Patch Changes

- a8ed7d2: Dependencies bump
- Updated dependencies [a8ed7d2]
  - @aiontheballot/observability@0.2.4

## 0.13.0

### Minor Changes

- c21932d: Change requests (editorial workflow CR1; PLAN R143): a live election's structure changes through proposals with a
  public note, approved by a country admin (or proposed and applied at once where the site needs no second approver),
  on the election's new Change requests screen.
- 4516915: Party logos (PLAN R142): uploaded on a party's admin page while its election is a draft (PNG, JPEG or WebP, up to 2 MB
  and 4,096 pixels a side, checked by its own header), and shown beside the party's name on the public pages.

### Patch Changes

- 1046110: Change requests after an adversarial review (PLAN R144): only country admins and platform admins approve, in the
  database too; two approvals of one target run one after the other; proposals are checked as a draft's forms check
  them, with the site's main language required at once; additions waiting for a decision keep their order; clearer
  buttons and wording in the admin.
- Updated dependencies [1046110]
- Updated dependencies [c21932d]
- Updated dependencies [bf4876f]
- Updated dependencies [4516915]
  - @aiontheballot/i18n@0.16.0
  - @aiontheballot/domain@0.10.0

## 0.12.0

### Minor Changes

- c99354a: Sources (editorial workflow §7): editors add an election's sources, store a copy of each (uploaded, up to 50 MB, the
  same bytes kept once per site, checked before a byte is read and streamed to the store), and members read the text
  extracted from it and download the copy. A new worker (`node dist/worker.js`, PLAN R116, R133 and R139) extracts the
  text one copy at a time, each in a child process with a memory limit, a deadline and no access to the disk, the
  network or its environment; the chart renders it only once gitops names its database login, and the API hands it
  each job (PLAN D12). Migration `open_extraction_once`: one open extraction job per source.

### Patch Changes

- Updated dependencies [c99354a]
  - @aiontheballot/i18n@0.15.0

## 0.11.1

### Patch Changes

- 8ef950e: A party's colour picker is always shown, with "No colour" as a box beside it (PLAN R138); the admin's localized fields
  no longer offer the browser's saved addresses (`autocomplete="off"`).

## 0.11.0

### Minor Changes

- 658a870: A site's public settings are data (PLAN R135): whether it is open, whether search engines may index it, and its
  Plausible script are switches on the site's admin page, for platform admins, instead of `OPEN_SITES` and
  `PLAUSIBLE_SITES` in the web app's environment. A site kept out of search engines answers `noindex, nofollow`
  everywhere, disallows everything in its robots.txt and has no sitemap, for a demo's fictional content.

### Patch Changes

- Updated dependencies [658a870]
  - @aiontheballot/domain@0.9.0
  - @aiontheballot/i18n@0.14.0

## 0.10.0

### Minor Changes

- 59950f5: The cell editor and the review workflow (PLAN R131): the election's cell grid, and each cell's page to draft a rating
  with quotes checked against their source as they are typed, record checked documents, submit, recall, publish, send
  back with a note, comment, clear a recheck flag and delete a cell never published, at the version loaded.
- 5c4e6b8: Invitations (PLAN R114): country admins invite someone by email with a role from the members page, revoke and delete
  invitations; the invited person follows the link, chooses a name and a password if they have no account, and the
  membership is theirs once they have set up their second factor.
- 91cfb5a: A party's programme status on the admin's party page (editorial workflow PS1, PLAN R128): a check records the status
  and its date, which the scorecard shows, in a live election too; "published" needs a source marked as the programme.
- 7bd93a4: The site's own signup list (PLAN R119, R122): double opt-in through three narrow database functions, a confirmation
  email through the platform's one sender (R115, R123), one-click unsubscribe, unconfirmed addresses deleted after 7
  days, and counts for country admins. The legal notice, privacy policy and page about the operator, served before the
  site opens (R124). Site modes (coming soon, open, preview) and a site's own words in its paths (R121).
- 5896c16: Sites on the platform's own screens (PLAN R129): platform admins list every site with its addresses, create one
  (off, with its operator) and turn it on or off. Demo content for a demo site (PLAN R130): a script prints the SQL
  that fills an empty, active site in a user-assigned country with an obviously fictional election.

### Patch Changes

- b869a83: The public site's election pages (PLAN R125): the scorecard, with a table on desktops and cards per party or per
  criterion on phones, and the party, criterion, cell and methodology pages, every cell able to show "pending", from a
  new public election route in the API. The fixed rating visuals. Security headers on every response (R126); per-site
  sitemaps and robots, and the page's language in `<html lang>` (R127).
- Updated dependencies [59950f5]
- Updated dependencies [5c4e6b8]
- Updated dependencies [91cfb5a]
- Updated dependencies [b869a83]
- Updated dependencies [4fc2f00]
- Updated dependencies [7bd93a4]
- Updated dependencies [5896c16]
  - @aiontheballot/i18n@0.13.0
  - @aiontheballot/domain@0.8.0

## 0.9.0

### Minor Changes

- 4572be4: Organizations on the platform's own screens (editorial workflow P2, PLAN R112): platform admins list every
  organization with the sites it serves, create one, and change its name, legal details, contact and privacy emails,
  links and whether it is a PauseAI chapter. Anyone else gets a 404.

### Patch Changes

- 7ba5873: Dependencies bump
- 285b124: Dependencies bump
- Updated dependencies [7ba5873]
- Updated dependencies [4572be4]
  - @aiontheballot/i18n@0.12.0
  - @aiontheballot/observability@0.2.3

## 0.8.0

### Minor Changes

- 88fbcfc: A language switch at the foot of every admin page (PLAN R108): English or Spanish, kept in a preference cookie on the
  admin host, over the browser's language, which still decides until someone chooses. With scripts, the page redraws in
  place and keeps what was typed. The accessibility check waits for a page redrawn after a save to get its title back.

### Patch Changes

- Updated dependencies [88fbcfc]
  - @aiontheballot/i18n@0.11.0

## 0.7.0

### Minor Changes

- 0ebe03a: Elections and their structure (editorial workflow §6, P1; PLAN R101–R106). Editors create elections as drafts and
  change them while they are; country admins announce and delete them, and write the methodology and its named external
  reviewers, take them live after a checklist and a typed confirmation, set their freeze window and archive them;
  platform admins turn four-eyes off after a confirmation. Editors add, order by keyboard, change and delete parties and
  criteria. Live and archived elections are shown read-only. Two migrations: `slug_length` (slugs stop at 63
  characters) and `report_retention_cap` (reports are kept a century at most). New API routes under
  `/api/t/:tenant/elections` and `/api/t/:tenant/e/:election`, with its `checklist`, `methodology`,
  `methodology/reviewers`, `parties` and `criteria`.

### Patch Changes

- Updated dependencies [0ebe03a]
  - @aiontheballot/i18n@0.10.0

## 0.6.0

### Minor Changes

- ed8f815: Tenant settings and policy texts (editorial workflow §5, P1; PLAN R99, R100). A site's settings screen shows everyone
  how long reports are kept and whether live changes need a second approver; country admins change the first and
  platform admins the second. Country admins write the privacy policy, the right-of-reply policy and the text about the
  operator per language, as drafts they save, publish after a confirmation or delete; published versions never change.
  New API routes: `PATCH /api/t/:tenant/settings`, `GET` and `POST /api/t/:tenant/documents`, and `PATCH` and `DELETE
/api/t/:tenant/documents/:id`.

### Patch Changes

- Updated dependencies [ed8f815]
  - @aiontheballot/i18n@0.9.0

## 0.5.0

### Minor Changes

- b0342af: Choosing a site and managing its members (editorial workflow A6, A7; PLAN R94–R98). After sign-in, a member of one
  site lands on its dashboard and anyone else on the site list; every site screen has a shell with a site switcher and
  its sections. The members screen shows everyone's names and roles, emails only to country and platform admins, and lets
  them remove a role (never the site's last country admin) or give a member another. New API routes: `GET /api/t/:tenant`,
  `GET /api/t/:tenant/members`, `POST /api/t/:tenant/members/:userId/roles` and
  `DELETE /api/t/:tenant/members/:userId/roles/:role`; `GET /api/tenants` also says whether the user is a platform admin.

### Patch Changes

- Updated dependencies [b0342af]
  - @aiontheballot/i18n@0.8.0

## 0.4.0

### Minor Changes

- 47da044: The first account (PLAN R93): `node dist/create-account.js`, run in an API pod, asks for an email and a name, creates
  a verified account and prints a single-use, one-hour link to the admin's new set-password page (its token in the
  fragment, kept hashed), plus the SQL that makes it a platform admin once its person has enrolled TOTP. The API accepts
  that token at /api/auth/reset-password, and setting a password ends the account's sessions. Error reports also drop
  the query and fragment of URL-like context fields and tags.

### Patch Changes

- Updated dependencies [47da044]
  - @aiontheballot/i18n@0.7.0
  - @aiontheballot/observability@0.2.2

## 0.3.0

### Minor Changes

- 83e9248: Sign in to the admin with a password and a TOTP code (PLAN R84–R92). The API mounts Better Auth's sign-in,
  enrolment and challenge endpoints under /api/auth on the admin host only, records per session whether a second factor
  opened it (migration auth_session_aal), acts at aal2 only for those sessions, and lists a signed-in user's tenants. A
  daily CronJob deletes expired sessions. The admin gets its sign-in, TOTP enrolment and challenge screens in English and
  Spanish.

### Patch Changes

- 1756b0e: CI passes the sign-in tests' database URLs through Turbo (TEST_ADMIN_DATABASE_URL for the API's database tests; the
  auth, admin and owner URLs for the end-to-end tests), which locally came from .env.
- Updated dependencies [83e9248]
  - @aiontheballot/i18n@0.6.0

## 0.2.8

### Patch Changes

- Updated dependencies [94c11b3]
- Updated dependencies [874daf8]
  - @aiontheballot/observability@0.2.1
  - @aiontheballot/i18n@0.5.1

## 0.2.7

### Patch Changes

- 4f5e76a: Better Auth's tables, in the `auth` schema that only `aiontheballot_auth` reaches (migration `auth_schema`,
  ADR-0002 §2), and `createAuthPool` for its connections. Nothing signs in yet.

## 0.2.6

### Patch Changes

- 07fb157: The pods mark their scratch volumes for file-system backups to skip: of the API's, only the file volume is
  copied.
- Updated dependencies [01a9f7f]
  - @aiontheballot/i18n@0.5.0

## 0.2.5

### Patch Changes

- a2cea6d: File bytes move from Postgres to a persistent volume (migration `files_on_volume`, ADR-0004): the API mounts a
  node-local volume at `/data` and reads each file's bytes from its row's own tenant and bucket, only
  for a row RLS shows, checking the hash on every read. `file_blobs` and the brand assets' inline bytes are gone; the
  migration refuses to run while any bytes are stored in the database. `node dist/put-file.js <tenant-id> <bucket>`
  puts bytes on the volume from stdin until the admin can upload them, and `node dist/purge-tenant-files.js` deletes a
  purged tenant's folder, given proof of the purge. Web and admin are rebuilt only because turbo.json changed.

## 0.2.4

### Patch Changes

- Updated dependencies [2a30cfe]
  - @aiontheballot/i18n@0.4.0

## 0.2.3

### Patch Changes

- Updated dependencies [1f4eabe]
  - @aiontheballot/i18n@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [2f43760]
- Updated dependencies [d167b29]
  - @aiontheballot/i18n@0.2.0

## 0.2.1

### Patch Changes

- 7a6d8c4: Run on Node 26.11.1: the base images (pinned by digest) and the engines range.

## 0.2.0

### Minor Changes

- 9504ee9: Report errors to GlitchTip (ADR-0003 §7). The API and the Next servers send to its in-cluster Service when
  SENTRY_DSN is set. Browsers send through /_relay/errors on the app's own host, which forwards only to that app's
  project with the DSN held server-side. The public site loads its browser SDK only on the first error. No personal data
  leaves the apps: data collection is off and every event is scrubbed (no user, no query strings, emails redacted). The
  i18n catalogue can be imported without the message formatter, and both apps get a root error page.

### Patch Changes

- Updated dependencies [9504ee9]
  - @aiontheballot/observability@0.2.0
  - @aiontheballot/i18n@0.1.1

## 0.1.0

### Minor Changes

- 6ed9131: Ship Docker images: web, admin and api built with turbo prune (manifest-only install layer), running as non-root, and
  a migrations image (dbmate plus the migrations) for the chart's PreSync Job. The Next apps run panda codegen as part of
  their build, so builds no longer depend on install-time hooks.
- 85ada24: Add the shared Panda preset (@aiontheballot/ui) and the public and admin Next.js skeletons: a translated placeholder page,
  an unlogged /healthz, zoom left enabled, and no cookies or X-Powered-By on the public app. Add the "coming soon"
  message. Build packages without composite/incremental output so a JSON-only change can never leave stale
  declarations.

### Patch Changes

- c217473: Add Playwright smoke tests against production builds of web, admin and api: pages render, health probes answer, and
  the public site sets no cookies and keeps zoom enabled. Read the platform name at request time: the layouts were
  prerendered at build time, so every image would have shipped without a title.
- 8a9f648: Add the Helm charts: a subchart per deployable and the `aiontheballot` umbrella chart (migrations as an Argo CD PreSync Job,
  routes for the public and admin hosts, restrictive security contexts and resource limits).
- e13c986: Move to @slango.configs/typescript 3.0.0 and @slango.configs/vitest 2.1.0: drop the composite/incremental overrides
  and the i18n JSON include they required, and write the Vitest configs in TypeScript.
- Updated dependencies [6e85ec0]
- Updated dependencies [e13c986]
- Updated dependencies [85ada24]
  - @aiontheballot/i18n@0.1.0
