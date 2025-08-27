#!/usr/bin/env node
/*
  Purge project tasks and knowledge via MCP stdio server using obsidian_import_project with strategy=replace.
  Options:
    --project <name>            default: mcp
    --scope <both|tasks|knowledge>  default: both
    --dry-run                   simulate only (no changes)
    --confirm                   required for destructive run (non-dry-run)

  Example:
    DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none node scripts/purge_project.js --project mcp --scope both --dry-run
    DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none node scripts/purge_project.js --project mcp --scope both --confirm
*/

const fs = require('fs')
const os = require('os')
const path = require('path')
const { Client } = require('@modelcontextprotocol/sdk/client')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio')

function parseArgs(argv) {
  const args = { project: 'mcp', scope: 'both', dryRun: false, confirm: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--project') { args.project = argv[++i]; continue }
    if (a === '--scope') { args.scope = argv[++i]; continue }
    if (a === '--dry-run') { args.dryRun = true; continue }
    if (a === '--confirm') { args.confirm = true; continue }
    console.error(`Unknown argument: ${a}`)
    process.exit(2)
  }
  if (!['both','tasks','knowledge'].includes(args.scope)) {
    console.error(`--scope must be one of: both|tasks|knowledge`)
    process.exit(2)
  }
  return args
}

async function ensureEmptyVaultDir() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-empty-vault-'))
  // create minimal structure
  fs.mkdirSync(path.join(base, 'Knowledge'), { recursive: true })
  fs.mkdirSync(path.join(base, 'Tasks'), { recursive: true })
  return base
}

async function main() {
  const args = parseArgs(process.argv)

  if (!args.dryRun && !args.confirm) {
    console.error('Refusing to proceed: destructive action requires --confirm')
    process.exit(3)
  }

  const cwd = process.cwd()
  const vaultRoot = await ensureEmptyVaultDir()

  const env = {
    ...process.env,
    DATA_DIR: process.env.DATA_DIR || path.join(cwd, 'data'),
    OBSIDIAN_VAULT_ROOT: vaultRoot,
    EMBEDDINGS_MODE: process.env.EMBEDDINGS_MODE || 'none',
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: path.join(cwd, 'mcp-task-knowledge'),
    env,
  })

  const client = new Client({
    name: 'purge-project-cli',
    version: '1.0.0',
    capabilities: {},
  }, transport)

  await client.connect()

  const doTasks = args.scope === 'both' || args.scope === 'tasks'
  const doKnowledge = args.scope === 'both' || args.scope === 'knowledge'

  const toolArgs = {
    project: args.project,
    knowledge: doKnowledge,
    tasks: doTasks,
    strategy: 'replace',
    dryRun: !!args.dryRun,
    confirm: args.dryRun ? false : true,
  }

  console.log('[purge] calling obsidian_import_project with:', JSON.stringify({ ...toolArgs, confirm: !!toolArgs.confirm }, null, 2))

  const res = await client.callTool({ name: 'obsidian_import_project', arguments: toolArgs })
  console.log('[purge] result:', JSON.stringify(res, null, 2))

  await client.close()
  console.log(`[purge] done. Vault used: ${vaultRoot}`)
}

main().catch((e) => {
  console.error(e?.stack || e)
  process.exit(1)
})
