#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { adminSettings, createAdminClient } from './admin-client.js';
import { registerTools } from './tools.js';

/**
 * The MCP server a member's AI tool starts on their machine (ADR-0008, PLAN R204), over stdio: it reads the admin's
 * address and the member's token from its environment and drafts through the admin's API as them.
 */
const main = async () => {
  const server = new McpServer({ name: 'aiontheballot-admin', version: '0.0.0' });
  registerTools(
    server,
    createAdminClient(adminSettings(process.env)),
    process.env['AIONTHEBALLOT_LOGO_DIR'],
  );
  await server.connect(new StdioServerTransport());
};

main().catch((error: unknown) => {
  // On stderr: stdout is the protocol's.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
