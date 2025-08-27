import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

// Will be populated after env is set
let planImportProjectFromVault: any
let importProjectFromVault: any
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

async function buildVaultStructure(root: string) {
  const prjRoot = path.join(root, PROJECT)
  // Knowledge
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'AreaA', 'INDEX.md'),
    md({ title: 'AreaA', tags: ['ml'], type: 'note' }, '# AreaA')
  )
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'AreaA', 'NoteOne.md'),
    md({ title: 'NoteOne', tags: ['ml'], type: 'note' }, 'Content One')
  )
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'AreaB', 'INDEX.md'),
    md({ title: 'AreaB', tags: ['private'], type: 'spec' }, '# AreaB')
  )
  await writeFile(
    path.join(prjRoot, 'Knowledge', 'AreaB', 'Skip.md'),
    md({ title: 'Skip', tags: ['private'], type: 'spec' }, 'Skip content')
  )

  // Tasks
  await writeFile(
    path.join(prjRoot, 'Tasks', 'Box1', 'INDEX.md'),
    md({ title: 'Box1', tags: ['work'], status: 'pending', priority: 'high' }, '# Box1')
  )
  await writeFile(
    path.join(prjRoot, 'Tasks', 'Box1', 'T1.md'),
    md({ title: 'T1', tags: ['work'], status: 'pending', priority: 'medium' }, 'Task 1')
  )
}

beforeAll(async () => {
  TMP_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-knowledge-data-'))
  TMP_VAULT_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-obsidian-vault-'))

  process.env.DATA_DIR = TMP_DATA_DIR
  process.env.OBSIDIAN_VAULT_ROOT = TMP_VAULT_ROOT

  await buildVaultStructure(TMP_VAULT_ROOT)

  // dynamic import AFTER env is set
  ;({ planImportProjectFromVault, importProjectFromVault } = await import('../import'))
  ;({ listDocs } = await import('../../storage/knowledge'))
  ;({ listTasks } = await import('../../storage/tasks'))
})

afterAll(async () => {
  await rimraf(TMP_DATA_DIR)
  await rimraf(TMP_VAULT_ROOT)
})

describe('obsidian import — path filters', () => {
  it('plan: includePaths only knowledge', async () => {
    const plan = await planImportProjectFromVault(PROJECT, {
      knowledge: true,
      tasks: false,
      includePaths: ['Knowledge/**/*.md'],
    })
    expect(plan.creates.knowledge).toBe(4) // AreaA/INDEX.md, AreaA/NoteOne.md, AreaB/INDEX.md, AreaB/Skip.md
    expect(plan.creates.tasks).toBe(0)
    expect(plan.updates.knowledge).toBe(0)
    expect(plan.deletes.knowledge).toBe(0)
  })

  it('plan: includePaths + excludePaths', async () => {
    const plan = await planImportProjectFromVault(PROJECT, {
      knowledge: true,
      tasks: false,
      includePaths: ['Knowledge/**/*.md'],
      excludePaths: ['Knowledge/AreaB/**'],
    })
    expect(plan.creates.knowledge).toBe(2) // AreaB excluded
    expect(plan.creates.tasks).toBe(0)
  })

  it('import: include only tasks', async () => {
    // cleanup storage for deterministic result
    await rimraf(path.join(TMP_DATA_DIR, 'knowledge', PROJECT))
    await rimraf(path.join(TMP_DATA_DIR, 'tasks', PROJECT))

    const result = await importProjectFromVault(PROJECT, {
      knowledge: false,
      tasks: true,
      strategy: 'merge',
      includePaths: ['Tasks/**/*.md'],
    })
    expect(result.tasksImported).toBe(2) // Box1/INDEX.md + T1.md
    expect(result.knowledgeImported).toBe(0)

    const tasks = await listTasks({ project: PROJECT })
    expect(tasks.length).toBe(2)
  })
})
