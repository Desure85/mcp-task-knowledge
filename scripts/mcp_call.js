#!/usr/bin/env node
// Universal MCP stdio client: call any tool with JSON args
// Usage:
//   DATA_DIR=/path EMBEDDINGS_MODE=none node scripts/mcp_call.js <toolName> '{"key":"val"}'
//   node scripts/mcp_call.js tools_list '{}'

import fs from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

function fatal(msg) { console.error(msg); process.exit(2) }

const [,, toolName, jsonArgs] = process.argv
if (!toolName) fatal('Tool name required. Example: node scripts/mcp_call.js project_list {}')

let args = {}
if (jsonArgs) {
  try { args = JSON.parse(jsonArgs) } catch (e) { fatal('Second argument must be valid JSON') }
}

const cwd = process.cwd()
const serverCwd = fs.existsSync(path.join(cwd, 'dist', 'index.js')) ? cwd : path.join(cwd, 'mcp-task-knowledge')
const serverPath = path.join(serverCwd, 'dist/index.js')
if (!fs.existsSync(serverPath)) fatal(`Server entrypoint not found: ${serverPath}`)

const env = { ...process.env }
if (!env.DATA_DIR) env.DATA_DIR = path.join(cwd, 'data')
if (!env.EMBEDDINGS_MODE) env.EMBEDDINGS_MODE = 'none'

const transport = new StdioClientTransport({ command: 'node', args: [serverPath], env })
const client = new Client({ name: 'mcp-call-cli', version: '1.0.0', capabilities: {} })

async function main() {
  await client.connect(transport)
  const res = await client.callTool({ name: toolName, arguments: args })
  const text = res?.content?.[0]?.text ?? JSON.stringify(res)
  console.log(text)
  await client.close()
}

main().catch(async (e) => {
  try { await client.close() } catch {}
  console.error(e?.message || e)
  if (e?.data) console.error(JSON.stringify(e.data))
  process.exit(1)
})
