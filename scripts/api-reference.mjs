#!/usr/bin/env node
// scripts/api-reference.mjs — Generate docs/api-reference.md from the live MCP server (D-001)
// Uses the running server's tools_list + tool_schema to produce a complete
// reference of all registered tools with their input schemas.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(process.cwd());

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), 'api-ref-'));
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      OBSIDIAN_VAULT_ROOT: join(dataDir, 'vault'),
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'true',
      MCP_TOOLS_ENABLED: 'true',
    },
  });
  const client = new Client({ name: 'api-ref-gen', version: '0.0.1' });
  await client.connect(transport);

  // tools_list returns { ok, data: { data: [...], pagination } }
  const listRes = await client.callTool({ name: 'tools_list', arguments: { offset: 0, limit: 100 } });
  const listEnv = JSON.parse(listRes?.content?.[0]?.text ?? '{}');
  const raw = listEnv.data?.data ?? listEnv.data ?? [];
  const tools = Array.isArray(raw) ? raw : [];

  const lines = [
    '# API Reference',
    '',
    '> Автогенерировано из live MCP-сервера (D-001). Пересборка: `npm run api:reference`.',
    '',
    `Всего инструментов: **${tools.length}**`,
    '',
    '## Инструменты',
    '',
    '| Инструмент | Описание |',
    '|------------|-----------|',
  ];
  for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| \`${t.name}\` | ${(t.description ?? '').split('\n')[0].slice(0, 100)} |`);
  }
  lines.push('');

  for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    const schemaRes = await client.callTool({ name: 'tool_schema', arguments: { name: t.name } });
    const schemaEnv = JSON.parse(schemaRes?.content?.[0]?.text ?? '{}');
    const meta = schemaEnv.data ?? {};

    lines.push(`## ${meta.name ?? t.name}`);
    lines.push('');
    if (meta.title) lines.push(`**${meta.title}**`);
    lines.push('');
    if (meta.description) lines.push(meta.description);
    lines.push('');

    const keys = Array.isArray(meta.inputKeys) ? meta.inputKeys : [];
    if (keys.length) {
      lines.push('**Параметры:**');
      lines.push('');
      for (const k of keys) lines.push(`- \`${k}\``);
      lines.push('');
    }

    if (meta.example && typeof meta.example === 'object') {
      lines.push('**Пример вызова:**');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify({ name: meta.name, arguments: meta.example }, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  const outFile = resolve(ROOT, 'docs/api-reference.md');
  writeFileSync(outFile, lines.join('\n'));
  console.log(`API reference written: ${outFile} (${tools.length} tools)`);

  await client.close();
  transport.close();
  rmSync(dataDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
