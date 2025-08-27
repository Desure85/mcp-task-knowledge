import { test, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, '..')

// Helper to create temporary data directory with test content
async function createTestDataDir() {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'))
  
  // Create test tasks
  const tasksDir = path.join(dataDir, 'mcp', 'tasks')
  await fs.promises.mkdir(tasksDir, { recursive: true })
  
  const testTasks = [
    { id: 'task-1', title: 'Pending task', status: 'pending', tags: ['foo'] },
    { id: 'task-2', title: 'Closed task', status: 'closed', tags: ['bar'] },
    { id: 'task-3', title: 'Completed task', status: 'completed', tags: ['foo', 'bar'] },
    { id: 'task-4', title: 'Archived task', status: 'pending', tags: ['archived'], archived: true },
    // trashed task that should not affect existing tests (tags don't match)
    { id: 'task-trashed', title: 'Trashed task', status: 'pending', tags: ['zzz'], trashed: true },
  ]
  
  for (const task of testTasks) {
    const taskPath = path.join(tasksDir, `${task.id}.json`)
    await fs.promises.writeFile(taskPath, JSON.stringify(task, null, 2))
  }
  
  // Create test knowledge
  const knowledgeDir = path.join(dataDir, 'mcp', 'knowledge')
  await fs.promises.mkdir(knowledgeDir, { recursive: true })
  
  const testKnowledge = [
    { id: 'doc-1', title: 'Note doc', type: 'note', tags: ['foo'] },
    { id: 'doc-2', title: 'Spec doc', type: 'spec', tags: ['bar'] },
    { id: 'doc-3', title: 'Archived spec', type: 'spec', tags: ['obsolete'], archived: true },
    // trashed knowledge doc that should not affect existing tests (type/tags don't match)
    { id: 'doc-trashed', title: 'Trashed note', type: 'note', tags: ['zzz'], trashed: true },
  ]
  
  for (const doc of testKnowledge) {
    const docPath = path.join(knowledgeDir, `${doc.id}.md`)
    const content = `---
title: ${doc.title}
tags: [${doc.tags?.join(', ') || ''}]
type: ${doc.type}
${doc.archived ? 'archived: true\n' : ''}${doc.trashed ? 'trashed: true\n' : ''}---\nContent of ${doc.title}`
    await fs.promises.writeFile(docPath, content)
  }
  
  return dataDir
}

// Helper to create MCP client
async function createClient(dataDir: string) {
  const serverPath = path.join(projectRoot, 'dist/index.js')
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Server not built: ${serverPath}`)
  }
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: {
      DATA_DIR: dataDir,
      EMBEDDINGS_MODE: 'none',
    },
  })
  
  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
    capabilities: {},
  })
  
  await client.connect(transport)
  return client
}

test('project_purge filters tasks by status and tags', async () => {
  const dataDir = await createTestDataDir()
  const client = await createClient(dataDir)
  
  try {
    // Dry-run purge with task filters
    const res = await client.callTool({
      name: 'project_purge',
      arguments: {
        project: 'mcp',
        scope: 'tasks',
        dryRun: true,
        tasksStatus: ['pending', 'closed'],
        tasksTags: ['foo', 'bar'],
      },
    })
    
    expect(res.content?.[0]?.text).toContain('counts')
    const result = JSON.parse(res.content![0].text!)
    expect(result.ok).toBe(true)
    expect(result.data.counts.tasks).toBe(2) // task-1 (pending+foo) and task-2 (closed+bar)
    
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true })
  }
})

test('project_purge filters knowledge by type and tags', async () => {
  const dataDir = await createTestDataDir()
  const client = await createClient(dataDir)
  
  try {
    // Dry-run purge with knowledge filters
    const res = await client.callTool({
      name: 'project_purge',
      arguments: {
        project: 'mcp',
        scope: 'knowledge',
        dryRun: true,
        knowledgeTypes: ['spec'],
        knowledgeTags: ['bar', 'obsolete'],
        includeArchived: true,
      },
    })
    
    expect(res.content?.[0]?.text).toContain('counts')
    const result = JSON.parse(res.content![0].text!)
    expect(result.ok).toBe(true)
    expect(result.data.counts.knowledge).toBe(2) // doc-2 (spec+bar) and doc-3 (spec+obsolete+archived)
    
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true })
  }
})

test('project_purge requires confirm for real purge', async () => {
  const dataDir = await createTestDataDir()
  const client = await createClient(dataDir)
  
  try {
    // Attempt real purge without confirm should fail
    const res = await client.callTool({
      name: 'project_purge',
      arguments: {
        project: 'mcp',
        scope: 'both',
        dryRun: false,
        confirm: false, // No confirm
        tasksStatus: ['pending'],
      },
    })
    expect(res.isError).toBe(true)
    expect(res.content?.[0]?.text).toContain('Refusing to proceed')
    
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true })
  }
})

test('project_purge includes trashed items when enumerating without filters', async () => {
  const dataDir = await createTestDataDir()
  const client = await createClient(dataDir)

  try {
    // Dry-run tasks without filters: should include archived and trashed
    const resTasks = await client.callTool({
      name: 'project_purge',
      arguments: {
        project: 'mcp',
        scope: 'tasks',
        dryRun: true,
      },
    })
    const parsedTasks = JSON.parse(resTasks.content![0].text!)
    expect(parsedTasks.ok).toBe(true)
    expect(parsedTasks.data.counts.tasks).toBe(5) // 4 regular (incl. 1 archived) + 1 trashed

    // Dry-run knowledge without filters: should include archived and trashed
    const resDocs = await client.callTool({
      name: 'project_purge',
      arguments: {
        project: 'mcp',
        scope: 'knowledge',
        dryRun: true,
      },
    })
    const parsedDocs = JSON.parse(resDocs.content![0].text!)
    expect(parsedDocs.ok).toBe(true)
    expect(parsedDocs.data.counts.knowledge).toBe(4) // 3 regular (incl. 1 archived) + 1 trashed
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true })
  }
})
