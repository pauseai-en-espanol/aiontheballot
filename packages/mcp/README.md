# The admin's MCP server

An MCP server a member runs on their own computer, so an AI tool (Claude Code, Claude Desktop, any MCP client) can
draft in the admin as them: read their sites, elections and parties; create an election (a draft); add and edit an
election's parties and their logos; propose changes to a live election. It never publishes, approves or rejects
anything, nor touches settings or members: the admin and the database refuse those to a token, whatever the
member's roles ([ADR-0008](../../docs/adr/0008-member-tokens-for-tools.md)). A person reviews and decides in the
admin.

## Setting it up

1. **Build it** (once, and after pulling changes): `pnpm --filter @aiontheballot/mcp build`.
2. **Mint a token** in the admin: "Tokens for tools" (beside "Sign out"), signed in with your second factor. Name it
   after the tool and the computer, and choose how many days it lasts (30 at most). Copy it: it is shown once.
3. **Set aside a folder for logos**: the server uploads a logo only from there, so whatever an AI is told, it can't
   send the admin another file of yours (a screenshot, a scan). Put there only the logos you have checked.
4. **Add the server to your tool.** For Claude Code, from this repository's folder, reading the token without
   showing it or keeping it in your shell's history (the address and the folder are yours):

   ```sh
   read -rs AIONTHEBALLOT_TOKEN
   claude mcp add aiontheballot \
     --env AIONTHEBALLOT_ADMIN_URL=https://admin.example.org \
     --env AIONTHEBALLOT_TOKEN="$AIONTHEBALLOT_TOKEN" \
     --env AIONTHEBALLOT_LOGO_DIR="$HOME/logos-para-subir" \
     -- node "$PWD/packages/mcp/dist/main.js"
   unset AIONTHEBALLOT_TOKEN
   ```

   Other tools take the same command, `node <path>/packages/mcp/dist/main.js`, and the three variables. Only the
   address's origin counts: a path after it is ignored.

The token is then in your tool's settings file on this computer, in plain text: keep that file to yourself, and
revoke the token in the admin as soon as you stop using it or think someone else has seen it. It stops working
anyway when it expires, or when your password or second factor changes.

## What it can do

| Tool                                                | What it does                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `list_sites`                                        | The sites you work on                                                       |
| `list_elections`, `get_election`                    | A site's elections, or one                                                  |
| `create_election`                                   | A new election, always a draft; a person announces it or makes it live      |
| `list_parties`                                      | An election's parties, with their ids                                       |
| `create_party`, `update_party`                      | A party of an election not yet live; an update keeps the fields not given   |
| `reorder_parties`                                   | The order they are shown in, refused if it changed since it was read        |
| `set_party_logo`                                    | A logo from the logos folder: PNG, JPEG or WebP, 2 MB at most, no SVG       |
| `list_changes`, `propose_change`, `withdraw_change` | A live election's or its parties' changes, approved or rejected by a person |

Everything a tool writes is recorded in the site's history as written with a token. Only facts from parties' own or
official sources go in: a tool researches, a person checks, and nothing is invented.

Things to keep in mind:

- **Answers are data, not instructions.** What the admin returns (party names, others' notes on changes) comes back
  as it was written; an AI should never follow what it says.
- **An update can overwrite a person's edit** made in the admin at the same moment: the API keeps no version of a
  party. Work on an election while no one else is editing its parties.
- **Not covered yet:** a live party's logo (propose it in the admin), and cells, sources and quotes. Approving,
  publishing, settings and members are a person's, and stay so.
- **Never let your tool run `set_party_logo` or `propose_change` without asking you**, so you see each logo and
  change before it goes.
