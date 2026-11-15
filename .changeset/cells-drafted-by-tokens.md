---
'@aiontheballot/migrations': minor
'@aiontheballot/api': minor
'@aiontheballot/mcp': minor
'@aiontheballot/domain': patch
'@aiontheballot/admin': patch
---

A member's token may draft cells: start one, set its draft's rating and summary, and add and remove its quotes and
the documents checked for "not mentioned", never submitting, recalling, deleting or attesting anything, nor deciding
a cell's recheck flag, report, change kind or public note. The MCP server has tools to read a cell and search a
source's text, and to write each draft its member accepted, adding a quote only once it matches the source.
