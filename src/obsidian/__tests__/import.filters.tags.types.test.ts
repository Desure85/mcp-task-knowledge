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
  // Knowledge: AreaC (ml/note), AreaD (private/spec)
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'AreaC', 'INDEX.md'),
    md({ title: 'AreaC', tags: ['ml', 'public'], type: 'note' }, '# AreaC')
  )
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'AreaC', 'Note2.md'),
    md({ title: 'Note2', tags: ['ml', 'public'], type: 'note' }, 'Note2 body')
  )
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'AreaD', 'INDEX.md'),
    md({ title: 'AreaD', tags: ['private'], type: 'spec' }, '# AreaD')
  )
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'AreaD', 'Note3.md'),
    md({ title: 'Note3', tags: ['private'], type: 'spec' }, 'Note3 body')
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

describe('obsidian import — knowledge filters: tags & types', () => {
  it('plan: includeTags only (ml)', async () => {
    const plan = await planImportProjectFromVault(PROJECT, {
      knowledge: true,
      tasks: false,
      includeTags: ['ml'],
    })
    expect(plan.creates.knowledge).toBe(2) // AreaC/INDEX.md + Note2.md
    expect(plan.creates.tasks).toBe(0)
  })

  it('plan: excludeTags (private)', async () => {
    const plan = await planImportProjectFromVault(PROJECT, {
      knowledge: true,
      tasks: false,
      excludeTags: ['private'],
    })
    expect(plan.creates.knowledge).toBe(2) // AreaD excluded
  })

  it('plan: includeTypes (spec)', async () => {
    const plan = await planImportProjectFromVault(PROJECT, {
      knowledge: true,
      tasks: false,
      includeTypes: ['spec'],
    })
    expect(plan.creates.knowledge).toBe(2) // AreaD/INDEX.md + Note3.md
  })
})
