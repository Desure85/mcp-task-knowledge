import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

let planImportProjectFromVault: any
let createDoc: any
let createTask: any
let listDocs: any
let listTasks: any

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
  // Knowledge: Zone1/INDEX.md (title Zone1) и A.md (title A)
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'Zone1', 'INDEX.md'),
    md({ title: 'Zone1', tags: ['pub'], type: 'note' }, '# Zone1')
  )
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'Zone1', 'A.md'),
    md({ title: 'A', tags: ['pub'], type: 'note' }, 'A body')
  )
  // Tasks: Box/INDEX.md (title Box) и T.md (title T)
  await writeFile(
    path.join(prjRoot, 'Tasks', 'Box', 'INDEX.md'),
    md({ title: 'Box', tags: ['team'], status: 'pending', priority: 'medium' }, '# Box')
  )
  await writeFile(
    path.join(prjRoot, 'Tasks', 'Box', 'T.md'),
    md({ title: 'T', tags: ['team'], status: 'in_progress', priority: 'high' }, 'Task T')
  )
}

beforeAll(async () => {
  TMP_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-knowledge-data-'))
  TMP_VAULT_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-obsidian-vault-'))
  process.env.DATA_DIR = TMP_DATA_DIR
  process.env.OBSIDIAN_VAULT_ROOT = TMP_VAULT_ROOT
  await buildVault(TMP_VAULT_ROOT)
  ;({ planImportProjectFromVault } = await import('../import'))
  ;({ createDoc, listDocs } = await import('../../storage/knowledge'))
  ;({ createTask, listTasks } = await import('../../storage/tasks'))
})

afterAll(async () => {
  await rimraf(TMP_DATA_DIR)
  await rimraf(TMP_VAULT_ROOT)
})

describe('obsidian import — dryRun plan (merge strategies)', () => {
  it('merge overwrite: empty storage => all creates', async () => {
    const plan = await planImportProjectFromVault(PROJECT, {
      knowledge: true,
      tasks: true,
      strategy: 'merge',
      mergeStrategy: 'overwrite',
    })
    expect(plan.deletes.knowledge).toBe(0)
    expect(plan.deletes.tasks).toBe(0)
    expect(plan.updates.knowledge).toBe(0)
    expect(plan.updates.tasks).toBe(0)
    expect(plan.creates.knowledge).toBe(2)
    expect(plan.creates.tasks).toBe(2)
    // no conflicts when storage empty
    expect(plan.conflicts.knowledge).toBe(0)
    expect(plan.conflicts.tasks).toBe(0)
  })

  it('merge overwrite: with existing titles => updates counted, conflicts tracked', async () => {
    // seed existing: knowledge title 'A' and task title 'Box'
    await createDoc({ project: PROJECT, title: 'A', content: 'seed' })
    await createTask({ project: PROJECT, title: 'Box', description: 'seed' })

    const plan = await planImportProjectFromVault(PROJECT, { strategy: 'merge', mergeStrategy: 'overwrite' })
    expect(plan.deletes.knowledge).toBe(0)
    expect(plan.deletes.tasks).toBe(0)
    expect(plan.updates.knowledge).toBe(1)
    expect(plan.creates.knowledge).toBe(1)
    expect(plan.updates.tasks).toBe(1)
    expect(plan.creates.tasks).toBe(1)
    expect(plan.conflicts.knowledge).toBe(1)
    expect(plan.conflicts.tasks).toBe(1)
    expect(plan.conflicts.sampleTitles.knowledge).toContain('A')
    expect(plan.conflicts.sampleTitles.tasks).toContain('Box')
  })

  it('merge append: with existing titles => creates on collisions, conflicts tracked', async () => {
    const plan = await planImportProjectFromVault(PROJECT, { strategy: 'merge', mergeStrategy: 'append' })
    // All four vault items are planned as creates (including colliding titles)
    expect(plan.creates.knowledge).toBe(2)
    expect(plan.creates.tasks).toBe(2)
    expect(plan.updates.knowledge).toBe(0)
    expect(plan.updates.tasks).toBe(0)
    expect(plan.conflicts.knowledge).toBe(1)
    expect(plan.conflicts.tasks).toBe(1)
  })

  it('merge skip: with existing titles => create only non-conflicting, conflicts tracked', async () => {
    const plan = await planImportProjectFromVault(PROJECT, { strategy: 'merge', mergeStrategy: 'skip' })
    expect(plan.updates.knowledge).toBe(0)
    expect(plan.updates.tasks).toBe(0)
    expect(plan.creates.knowledge).toBe(1) // Zone1
    expect(plan.creates.tasks).toBe(1) // T
    expect(plan.conflicts.knowledge).toBe(1)
    expect(plan.conflicts.tasks).toBe(1)
  })
})
