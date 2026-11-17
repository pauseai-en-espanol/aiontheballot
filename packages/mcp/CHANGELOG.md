# @aiontheballot/mcp

## 0.3.2

### Patch Changes

- a2a2a98: The MCP server's cell tools say a cell in review takes no edit until it is back in draft, before sending anything,
  instead of passing on the database's bare refusal.

## 0.3.1

### Patch Changes

- c782da3: The MCP server's writes without a body (removing a quote or a checked document, withdrawing a proposed change) no
  longer say their empty body is JSON, which the admin's API refused.

## 0.3.0

### Minor Changes

- 4861bfe: A member's token may draft cells: start one, set its draft's rating and summary, and add and remove its quotes and
  the documents checked for "not mentioned", never submitting, recalling, deleting or attesting anything, nor deciding
  a cell's recheck flag, report, change kind or public note. The MCP server has tools to read a cell and search a
  source's text, and to write each draft its member accepted, adding a quote only once it matches the source.

### Patch Changes

- Updated dependencies [4861bfe]
  - @aiontheballot/domain@0.16.7

## 0.2.6

### Patch Changes

- 267ab61: Dependencies bump

## 0.2.5

### Patch Changes

- 7de5d6a: Dependencies bump

## 0.2.4

### Patch Changes

- bbc752a: Dependencies bump

## 0.2.3

### Patch Changes

- 8a14730: Dependencies bump
- 5475128: Dependencies bump

## 0.2.2

### Patch Changes

- 705210c: Dependencies bump

## 0.2.1

### Patch Changes

- 41136b9: Dependencies bump

## 0.2.0

### Minor Changes

- 6df3e0a: A member's token may add, edit and order an election's criteria while it is edited directly, never delete one nor
  link one to a core criterion; the MCP server has tools for them, carrying only wording a person approved.

## 0.1.0

### Minor Changes

- c9e487a: The admin's MCP server (PLAN R204, ADR-0008): an AI tool on a member's machine drafts an election's parties and
  their logos in the admin through the member's token, and proposes changes to a live election; never more.
