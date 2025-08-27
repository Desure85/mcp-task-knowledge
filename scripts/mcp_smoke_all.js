#!/usr/bin/env node
/*
  MCP smoke: run a suite of safe (dry-run) calls against stdio server.
  Usage:
    DATA_DIR=/path EMBEDDINGS_MODE=none node scripts/mcp_smoke_all.js
*/
import fs from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const cwd = process.cwd()
const serverCwd = fs.existsSync(path.join(cwd, 'dist', 'index.js')) ? cwd : path.join(cwd, 'mcp-task-knowledge')
const serverPath = path.join(serverCwd, 'dist/index.js')
if (!fs.existsSync(serverPath)) {
  console.error(`Server entrypoint not found: ${serverPath}`)
  process.exit(2)
}

const env = { ...process.env }
if (!env.DATA_DIR) env.DATA_DIR = path.join(cwd, 'data')
if (!env.EMBEDDINGS_MODE) env.EMBEDDINGS_MODE = 'none'

function section(title) { console.log(`\n=== ${title} ===`) }

const calls = [
  ['tools_list', {}],
  ['project_list', {}],
  ['embeddings_status', {}],
  ['service_catalog_health', {}],
  ['tasks_list', {}],
  ['tasks_tree', {}],
  ['knowledge_list', {}],
  ['knowledge_tree', {}],
  ['search_tasks', { query: 'demo', limit: 5 }],
  ['search_knowledge', { query: 'demo', limit: 5 }],
  ['search_knowledge_two_stage', { query: 'demo', prefilterLimit: 10, chunkSize: 800, chunkOverlap: 100 }],
  ['obsidian_export_project', { project: 'mcp', tasks: true, knowledge: true, strategy: 'merge', dryRun: true }],
  ['obsidian_import_project', { project: 'mcp', tasks: true, knowledge: true, dryRun: true }],
  ['project_purge', { project: 'mcp', scope: 'both', dryRun: true }],
]

const transport = new StdioClientTransport({ command: 'node', args: [serverPath], env })
const client = new Client({ name: 'mcp-smoke', version: '1.0.0', capabilities: {} })

function parseEnvelope(res) {
  const text = res?.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return res }
}

async function main() {
  await client.connect(transport)
  let failures = 0
  for (const [name, args] of calls) {
    section(name)
    try {
      const res = await client.callTool({ name, arguments: args })
      const env = parseEnvelope(res)
      if (env && typeof env === 'object' && 'ok' in env) {
        console.log(JSON.stringify({ name, ok: env.ok, summary: env.ok ? 'ok' : env.error?.message }, null, 2))
        if (env.ok !== true) failures++
      } else {
        // tools_list etc. return envelope directly
        console.log(JSON.stringify(res, null, 2))
      }
    } catch (e) {
      failures++
      console.error(`[FAIL] ${name}:`, e?.message || e)
      if (e?.data) console.error(JSON.stringify(e.data, null, 2))
    }
  }
  await client.close()
  if (failures) {
    console.error(`\nSmoke finished with ${failures} failures`)
    process.exit(1)
  }
  console.log('\nSmoke finished: all ok')
}

main().catch(async (e) => { try { await client.close() } catch {}; console.error(e?.stack || e); process.exit(1) })
