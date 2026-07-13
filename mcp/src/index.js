#!/usr/bin/env node
// TSI-Intel MCP server (stdio transport, for Claude Desktop / Claude Code).
// For claude.ai web, deploy the Cloudflare Worker in ../worker instead — both
// share the tool definitions in ./tools.js.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import * as api from './worker.js';
import { config } from './worker.js';
import * as ref from './reference.js';
import { buildTools } from './tools.js';

const server = new McpServer({ name: 'tsi-intel-mcp', version: '0.2.0' });

const tools = buildTools({ api, ref, user: config.user });
for (const t of tools) {
  server.registerTool(
    t.name,
    { title: t.title, description: t.description, inputSchema: t.input },
    async (args) => {
      try {
        const data = await t.run(args || {});
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message || e}` }], isError: true };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
console.error(`tsi-intel-mcp ready · ${tools.length} tools · worker=${config.workerUrl} · user=${config.user}`);
