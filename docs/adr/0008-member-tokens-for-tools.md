# ADR-0008: A member's tokens for tools (an MCP server on their machine)

- **Status:** Accepted (Dani, 2026-10-15: "i want to start now", choosing each recommendation below). Database part
  built in PLAN R202; the API and the admin page in R203; the MCP server in R204. **Amended 2026-10-30** (Dani, PLAN
  D23): a token never reaches the riskiest actions, and minting one is one of them (the API, below).
- **Date:** 2026-10-15; amended 2026-10-30
- **Deciders:** Dani; drafted by Claude
- **Relates to:** BRIEF §4 (four-eyes), §8 (least privilege); [ADR-0002](0002-tenancy-and-authorization.md) (§3 the
  actor, §6 definer functions, §9 MFA in the database, §12 change control); PLAN "Later: an MCP server for feeding
  in information", R202–R204

## Context

- **What is wanted.** Loading an election's data (its parties, their names, colours, logos and websites) is research
  an AI tool does well, then typing an editor does slowly: for the general election of 29 November 2026 a dozen
  parties, each with five fields and a logo, from sources the tool already found. PLAN planned an MCP server for this
  after launch; Dani asked for it now, to bootstrap the election.
- **How the admin API knows who calls.** Only through Better Auth's session cookie, and only once the session was
  opened with the second factor (aal2); every write must come from the admin's own origin (CSRF). There are no API
  tokens of any kind: the worker's, the fetcher's and the preview's shared secrets never make an actor.
- **What the database trusts.** `withActor` sets `app.user_id` and `app.aal` from the session the API checked
  (ADR-0002 §3, §9). The database enforces that private data needs aal2, four-eyes on cells (`publish_revision`),
  approval of live changes (`change_control`) and who may do what; it doesn't know how a request reached the API.
- **The PLAN's rules for the server.** It acts as a real member through `withActor`; it only creates drafts and
  suggestions, never publishes; and what it writes says where it came from.

## Options considered

1. **Where the server runs.** (a) On the member's machine, started by their AI tool (MCP over stdio), calling the
   admin API over HTTPS like the admin does: nothing new faces the internet but a header the API reads. (b) Hosted in
   the API as a remote MCP endpoint, usable from claude.ai too: it needs OAuth sign-in and is a new public surface.
2. **Who it acts as.** (a) The member, through a token they mint while signed in with their second factor. (b) A
   service account, a separate member with its own roles per site: clearer in the history, but someone must invite
   it and manage its roles, and it has no second factor of its own.
3. **How it is kept from publishing.** (a) Only by the API's list of routes a token may reach. (b) That list, and the
   database refusing, from a token, every decision a person must take, whatever the member's roles.
4. **Whether the history shows it.** (a) No: its writes look like the member's. (b) The audit log names the token.

Dani chose 1a, 2a, 3b and 4b, as recommended.

## Decision

**A member's token** (`auth.member_tokens`, R202):

- Minted in the admin by a member signed in with their second factor, for a tool they name; shown once. Only its
  SHA-256 is stored. Better Auth's role mints and checks tokens; no other role reaches the table. Like Better Auth's
  tables it holds no tenant data, so it lives in `auth` without RLS (ADR-0002 §2); `auth`'s comparison with what
  Better Auth generates leaves it out by name.
- The database refuses a token not minted from a live aal2 session of its own member whose second factor exists and
  was verified, and dates it itself; it lasts 30 days at most.
- It changes only when it was last used and when it was revoked, both stamped with the database's clock; a revocation
  is never undone, and Better Auth's role can't delete one (it stays as history until its account is deleted).
  Minting and revoking are recorded there, not in `app.audit_log`, which holds tenant data.
- Every token of a member is revoked when a password of theirs is set, changed or removed, or their second factor is
  removed or enrolled again, so a token never outlives what it was minted from (ADR-0002 §9, §10). All but the
  enrolment (which happens inside a session) also end the member's sessions in the same transaction, and minting
  queues behind such a change on the account's row: no session opened before it mints a token after it, and no token
  being minted while it happens escapes it.

**A token drafts; a person decides** (`private.needs_a_person`, R202). The API sets `app.token_id` beside
`app.user_id` for a request that carries a token. Through one, every table refuses any write, whatever the member may
do, except what drafting needs:

- an election's own details while the public doesn't see it, neither announced on the coming-soon page nor live
  (never its status, announcement, freeze window or second-reviewer rule, nor deleting it);
- its parties, including removing or retiring one, while the election is edited directly (a live election's go
  through change requests); never whether their programme is published, which the public sees and which reopens
  checks;
- its criteria, adding, editing and ordering them while the election is edited directly (amended, PLAN R213, Dani's
  decision); never deleting one, nor linking one to a core criterion. Their words are the site's: the tool is told to
  enter only the exact wording a person gave and approved, which the database can't tell from wording a tool wrote,
  so a person rereads them before the election goes live;
- the files their logos are (the public assets bucket only);
- changes its member proposes to a live election and its parties, and withdrawing them (never approving or rejecting
  one, nor withdrawing someone else's, nor proposing one to its criteria or methodology, R213);
- what the database writes itself for those (the audit log, the public cache).

A table added later refuses it too, until a catalog test's list says otherwise, so widening what a tool may do is a
decision taken on purpose: cells, sources and quotes, which a tool could draft well, are not open to it yet. A person
reviews, decides and publishes, in the admin, as before.

**The audit log names the token** (`audit_log.token_id`, R202): `private.audit`, the log's only writer, copies it
from the request beside its member. Its id only: the name its member gave it stays in `auth`, where the admin reads
it, and may say more about them than the log should keep. `private.audit`'s body changes; it stays on ADR-0002 §6's
allowlist, with no new definer function or grant.

**The API** (R203):

- A request carrying `Authorization: Bearer <token>` acts as the token's member at aal2, if the token is unrevoked and
  unexpired and its member still has their second factor; its `last_used_at` is updated at most once a minute.
- Such a request reaches only the routes marked for tokens, which the database's list above bounds: reading the
  member's sites, elections, parties and criteria; creating an election (always a draft), and creating, editing and
  ordering parties and criteria and setting the parties' logos where the election is edited directly (criteria since
  R213); proposing a change to a live one and withdrawing it. Every other route refuses it
  (403), the token routes themselves included, so a token never mints, lists or revokes tokens.
- It carries no cookie and is never sent one, so the Origin check that stops cross-site writes doesn't apply to it; a
  request carrying both a cookie and a token is refused.
- The member mints, lists and revokes their tokens in the admin, signed in with their second factor.
- Amended (PLAN D23, R224): the riskiest actions want a second factor of the last 12 hours, which a token, acting at
  aal2 with no session, has none of. A route marked as one refuses any request carrying a token (403 `notForTokens`)
  before it runs, whatever the routes above let a token reach, and a test keeps every always-marked route off them.
  The one marked for some bodies only, proposing a change, stays a token's, but not applying it as it is proposed.
  Minting a token is itself one of the riskiest actions, since a token outlives the session it was minted from, as is
  adding a passkey; and removing a passkey revokes its member's tokens, as a changed password does (PLAN D22).

**The MCP server** (R204) runs on the member's machine, started by their AI tool, with the admin's address and the
token in its environment. Its tools are the routes above, and it uploads logos from local files.

## Consequences

- **Easier.** A tool loads an election's structure as drafts, with its sources at hand; the history says what it
  wrote; a person approves what goes live.
- **Accepted risk.** A token leaked from the member's machine acts as them, at aal2, for up to 30 days or until
  revoked, within the token routes and short of every decision above. That is more than a password alone gives
  (nothing, ADR-0002 §9), so a token is shown once, named, revocable at once in the admin, and listed with when it was
  last used. Revisit when tools should draft more (cells, sources, quotes): each table opened is a decision.
- **Trust, unchanged.** `app.token_id` is the API's word, as `app.user_id` and `app.aal` are (T23): a compromised API
  or an injection in an admin route could omit it, as it could impersonate anyone. A later step could have the
  database check a token's hash itself (a definer helper; this ADR and ADR-0002 would be amended).
- **An `Authorization` header is a token's.** The admin's data routes treat any request carrying one as a tool's, so a
  basic-auth gate put in front of the admin (for a staging copy, say) would lock its browsers out: use another gate.
- **Harder.** Every route a tool may use is marked for tokens on purpose, and the tables it writes are listed for
  them in the database; a new table is closed to tokens until listed.
