import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

let planImportProjectFromVault: any

const PROJECT = 'mcp'
let TMP_DATA_DIR = ''
let TMP_VAULT_ROOT = ''

async function rimraf(p: string) {
  try { await fs.rm(p, { recursive: true, force: true }) } catch {}
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

async function writeFile(p: string, content: string) {
  await ensureDir(path.dirname(p))
  await fs.writeFile(p, content, 'utf8')
}

function md(front: any, body = ''): string {
  const yaml = Object.entries(front)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}`
      return `${k}: ${v}`
    })
    .join('\n')
  return `---\n${yaml}\n---\n\n${body}`
}

async function buildVault(root: string) {
  const prjRoot = path.join(root, PROJECT)
  // Tasks structure for status/priority filters
  await writeFile(
    path.join(prjRoot, 'Tasks', 'Alpha', 'INDEX.md'),
    md({ title: 'Alpha', tags: ['team'], status: 'completed', priority: 'medium' }, '# Alpha')
  )
  await writeFile(
    path.join(prjRoot, 'Tasks', 'Alpha', 'T_done.md'),
    md({ title: 'T_done', tags: ['team'], status: 'completed', priority: 'low' }, 'Task done')
  )
  await writeFile(
    path.join(prjRoot, 'Tasks', 'Beta', 'INDEX.md'),
    md({ title: 'Beta', tags: ['team'], status: 'pending', priority: 'high' }, '# Beta')
  )
  await writeFile(
    path.join(prjRoot, 'Tasks', 'Beta', 'T_high.md'),
    md({ title: 'T_high', tags: ['team'], status: 'in_progress', priority: 'high' }, 'High prio task')
  )
}

beforeAll(async () => {
  TMP_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-knowledge-data-'))
  TMP_VAULT_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-obsidian-vault-'))
  process.env.DATA_DIR = TMP_DATA_DIR
  process.env.OBSIDIAN_VAULT_ROOT = TMP_VAULT_ROOT
  await buildVault(TMP_VAULT_ROOT)
  ;({ planImportProjectFromVault } = await import('../import'))
})

afterAll(async () => {
  await rimraf(TMP_DATA_DIR)
  await rimraf(TMP_VAULT_ROOT)
})

describe('obsidian import — task filters: status & priority', () => {
  it('plan: includeStatus completed', async () => {
    const plan = await planImportProjectFromVault(PROJECT, {
      knowledge: false,
      tasks: true,
      includeStatus: ['completed'],
    })
    expect(plan.creates.tasks).toBe(2) // Alpha/INDEX.md + Alpha/T_done.md
    expect(plan.creates.knowledge).toBe(0)
  })

  it('plan: includePriority high', async () => {
    const plan = await planImportProjectFromVault(PROJECT, {
      knowledge: false,
      tasks: true,
      includePriority: ['high'],
    })
    expect(plan.creates.tasks).toBe(2) // Beta/INDEX.md + Beta/T_high.md
  })
})
