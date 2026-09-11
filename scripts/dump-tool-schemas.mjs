/**
 * scripts/dump-tool-schemas.mjs — dump all registered MCP tools with input schemas.
 *
 * Usage (inside repo root, dist/ must be built):
 *   DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none CATALOG_ENABLED=false node scripts/dump-tool-schemas.mjs > tools.json
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-dump-'));

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: {
    ...process.env,
    DATA_DIR: process.env.DATA_DIR || path.join(tmp, 'store'),
    OBSIDIAN_VAULT_ROOT: path.join(tmp, 'vault'),
    EMBEDDINGS_MODE: process.env.EMBEDDINGS_MODE || 'none',
    CATALOG_ENABLED: process.env.CATALOG_ENABLED || 'false',
    STARTUP_SILENT: '1',
    LOG_STARTUP: '0',
  },
  stderr: 'ignore',
});

const client = new Client({ name: 'schema-dump', version: '0.0.1' });
await client.connect(transport);
const res = await client.listTools();
process.stdout.write(
  JSON.stringify(
    res.tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? {} })),
    null,
    2,
  ) + '\n',
);
await client.close();
await fsp.rm(tmp, { recursive: true, force: true });
