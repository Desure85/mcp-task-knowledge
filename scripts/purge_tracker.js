#!/usr/bin/env node
/*
  Purge MCP tracker tasks and knowledge via MCP stdio server using bulk permanent delete.
  Options:
    --project <name>                         default: mcp
    --scope <both|tasks|knowledge>           default: both
    --dry-run                                simulate only (no changes)
    --confirm                                required for destructive run (non-dry-run)
    --include-archived                       include archived items in selection (default: true)
    NOTE: trashed items are ALWAYS included in selection and will be permanently deleted during purge.
    --tasks-status <s1[,s2,...]>             filter tasks by status list
    --tasks-tag <tag>                        repeatable; filter tasks by any of tags
    --tasks-tags <t1[,t2,...]>               same as above via CSV
    --tasks-parent <id>                      filter tasks by direct parentId
    --tasks-include-descendants              if set with --tasks-parent, include all descendants
    --knowledge-tag <tag>                    repeatable; filter knowledge by any of tags
    --knowledge-tags <t1[,t2,...]>          same as above via CSV
    --knowledge-type <type>                  repeatable; filter knowledge types
    --knowledge-types <t1[,t2,...]>         same as above via CSV
    --knowledge-parent <id>                  filter knowledge by direct parentId
    --knowledge-include-descendants          if set with --knowledge-parent, include all descendants

  Example:
    DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none node scripts/purge_tracker.js --project mcp --scope both --dry-run
    DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none node scripts/purge_tracker.js --project mcp --scope both --confirm
*/

import path from 'node:path'
import fs from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

function parseArgs(argv) {
  const args = { project: 'mcp', scope: 'both', dryRun: false, confirm: false, includeArchived: true }
  const tasksTags = new Set()
  const knowledgeTags = new Set()
  const knowledgeTypes = new Set()
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--project') { args.project = argv[++i]; continue }
    if (a === '--scope') { args.scope = argv[++i]; continue }
    if (a === '--dry-run') { args.dryRun = true; continue }
    if (a === '--confirm') { args.confirm = true; continue }
    if (a === '--include-archived') { args.includeArchived = true; continue }
    if (a === '--tasks-status') { args.tasksStatus = argv[++i]; continue }
    if (a === '--tasks-tag') { tasksTags.add(argv[++i]); continue }
    if (a === '--tasks-tags') { String(argv[++i]).split(',').forEach(v=>tasksTags.add(v.trim())) ; continue }
    if (a === '--tasks-parent') { args.tasksParentId = argv[++i]; continue }
    if (a === '--tasks-include-descendants') { args.tasksIncludeDescendants = true; continue }
    if (a === '--knowledge-tag') { knowledgeTags.add(argv[++i]); continue }
    if (a === '--knowledge-tags') { String(argv[++i]).split(',').forEach(v=>knowledgeTags.add(v.trim())) ; continue }
    if (a === '--knowledge-type') { knowledgeTypes.add(argv[++i]); continue }
    if (a === '--knowledge-types') { String(argv[++i]).split(',').forEach(v=>knowledgeTypes.add(v.trim())) ; continue }
    if (a === '--knowledge-parent') { args.knowledgeParentId = argv[++i]; continue }
    if (a === '--knowledge-include-descendants') { args.knowledgeIncludeDescendants = true; continue }
    console.error(`Unknown argument: ${a}`)
    process.exit(2)
  }
  if (!['both','tasks','knowledge'].includes(args.scope)) {
    console.error(`--scope must be one of: both|tasks|knowledge`)
    process.exit(2)
  }
  if (tasksTags.size) args.tasksTags = Array.from(tasksTags).filter(Boolean)
  if (knowledgeTags.size) args.knowledgeTags = Array.from(knowledgeTags).filter(Boolean)
  if (knowledgeTypes.size) args.knowledgeTypes = Array.from(knowledgeTypes).filter(Boolean)
  if (typeof args.tasksStatus === 'string' && args.tasksStatus.includes(',')) {
    args.tasksStatus = args.tasksStatus.split(',').map(s=>s.trim()).filter(Boolean)
  }
  return args
}

async function callToolPrefer(client, variants, args) {
  let lastErr
  for (const name of variants) {
    try {
      return await client.callTool({ name, arguments: args })
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

async function main() {
  console.log('[purge-tracker] start')
  const args = parseArgs(process.argv)
  const cwd = process.cwd()

  if (!args.dryRun && !args.confirm) {
    console.error('Refusing to proceed: destructive action requires --confirm')
    process.exit(3)
  }

  const env = {
    ...process.env,
    DATA_DIR: process.env.DATA_DIR || path.join(cwd, 'data'),
    EMBEDDINGS_MODE: process.env.EMBEDDINGS_MODE || 'none',
  }

  // Determine server working directory
  const serverCwd = fs.existsSync(path.join(cwd, 'dist', 'index.js'))
    ? cwd
    : path.join(cwd, 'mcp-task-knowledge')

  // Validate server entrypoint
  const serverPath = path.join(serverCwd, 'dist/index.js')
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Server entrypoint not found: ${serverPath}`)
  }

  // Create transport and client
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env,
  })

  const client = new Client({
    name: 'purge-tracker-cli',
    version: '1.0.0',
    capabilities: {},
  })

  try {
    await client.connect(transport)
    console.log('[purge-tracker] connected to MCP server')
  } catch (e) {
    console.error('[purge-tracker] connect failed:', e?.stack || e)
    process.exit(1)
  }

  // Call unified project_purge tool with filters
  const purgeArgs = {
    project: args.project,
    scope: args.scope,
    dryRun: !!args.dryRun,
    confirm: !!args.confirm,
    includeArchived: args.includeArchived,
    tasksStatus: args.tasksStatus,
    tasksTags: args.tasksTags,
    tasksParentId: args.tasksParentId,
    tasksIncludeDescendants: !!args.tasksIncludeDescendants,
    knowledgeTags: args.knowledgeTags,
    knowledgeTypes: args.knowledgeTypes,
    knowledgeParentId: args.knowledgeParentId,
    knowledgeIncludeDescendants: !!args.knowledgeIncludeDescendants,
  }

  try {
    const res = await callToolPrefer(client, ['project_purge'], purgeArgs)
    const text = res?.content?.[0]?.text || JSON.stringify(res, null, 2)
    console.log('[purge-tracker] result:', text)
  } catch (e) {
    console.error('[purge-tracker] tool call failed:', e?.stack || e)
    process.exit(1)
  } finally {
    await client.close()
  }

  console.log(args.dryRun ? '[purge-tracker] dry-run complete (no changes)' : '[purge-tracker] done')
}

process.on('unhandledRejection', (e) => {
  console.error('[purge-tracker] unhandledRejection:', e?.stack || e)
})
process.on('uncaughtException', (e) => {
  console.error('[purge-tracker] uncaughtException:', e?.stack || e)
})

main().then(() => {
  // noop
}).catch((e) => {
  console.error('[purge-tracker] fatal:', e?.stack || e)
  process.exit(1)
})
