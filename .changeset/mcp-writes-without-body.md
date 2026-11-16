---
'@aiontheballot/mcp': patch
---

The MCP server's writes without a body (removing a quote or a checked document, withdrawing a proposed change) no
longer say their empty body is JSON, which the admin's API refused.
