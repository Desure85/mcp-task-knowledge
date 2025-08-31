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

async function createTestDataDir() {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mcp-search-test-'))

  // tasks
  const tasksDir = path.join(dataDir, 'mcp', 'tasks')
  await fs.promises.mkdir(tasksDir, { recursive: true })
  const tasks = [
    { id: 't1', title: 'Vector adapter lazy init', description: 'hybrid search should fallback to bm25', status: 'pending' },
    { id: 't2', title: 'Another task', description: 'irrelevant content', status: 'pending' },
  ]
  for (const t of tasks) {
    await fs.promises.writeFile(path.join(tasksDir, `${t.id}.json`), JSON.stringify(t, null, 2))
  }

  // knowledge
  const knowledgeDir = path.join(dataDir, 'mcp', 'knowledge')
  await fs.promises.mkdir(knowledgeDir, { recursive: true })
  const docs = [
    { id: 'd1', title: 'Search Knowledge Doc', type: 'note', tags: ['search'], content: 'bm25 fallback path should work when embeddings are disabled' },
    { id: 'd2', title: 'Noise', type: 'note', tags: ['misc'], content: 'nothing interesting here' },
  ]
  for (const d of docs) {
    const frontMatter = `---\n` +
      `title: ${d.title}\n` +
      `tags: [${(d.tags || []).join(', ')}]\n` +
      `type: ${d.type}\n` +
      `---\n`;
    await fs.promises.writeFile(path.join(knowledgeDir, `${d.id}.md`), frontMatter + (d.content || ''))
  }

  return dataDir
}

async function createClient(dataDir: string) {
  const serverPath = path.join(projectRoot, 'dist/index.js')
  if (!fs.existsSync(serverPath)) throw new Error(`Server not built: ${serverPath}`)
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: {
      DATA_DIR: dataDir,
      EMBEDDINGS_MODE: 'none', // ensure lazy init path returns undefined
    },
  })
  const client = new Client({ name: 'test-client', version: '1.0.0', capabilities: {} })
  await client.connect(transport)
  return client
}

test('search_tasks falls back to BM25 when embeddings disabled', async () => {
  const dataDir = await createTestDataDir()
  const client = await createClient(dataDir)
  try {
    const res = await client.callTool({
      name: 'search_tasks',
      arguments: { project: 'mcp', query: 'hybrid bm25', limit: 5 },
    })
    expect(res.isError).not.toBe(true)
    const parsed = JSON.parse(res.content![0].text!)
    expect(parsed.ok).toBe(true)
    expect(Array.isArray(parsed.data)).toBe(true)
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true })
  }
})

test('search_knowledge falls back to BM25 when embeddings disabled', async () => {
  const dataDir = await createTestDataDir()
  const client = await createClient(dataDir)
  try {
    const res = await client.callTool({
      name: 'search_knowledge',
      arguments: { project: 'mcp', query: 'bm25 fallback', limit: 5 },
    })
    if (res.isError) {
      // Debug output
      // eslint-disable-next-line no-console
      console.error('search_knowledge error:', res.content?.[0]?.text)
    }
    expect(res.isError).not.toBe(true)
    const parsed = JSON.parse(res.content![0].text!)
    expect(parsed.ok).toBe(true)
    expect(Array.isArray(parsed.data)).toBe(true)
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true })
  }
})

test('mcp1_search_knowledge_two_stage works with lazy vector adapter', async () => {
  const dataDir = await createTestDataDir()
  const client = await createClient(dataDir)
  try {
    const res = await client.callTool({
      name: 'mcp1_search_knowledge_two_stage',
      arguments: { project: 'mcp', query: 'embeddings disabled bm25', prefilterLimit: 5, limit: 3 },
    })
    if (res.isError) {
      // Debug output
      // eslint-disable-next-line no-console
      console.error('two_stage error:', res.content?.[0]?.text)
    }
    expect(res.isError).not.toBe(true)
    const parsed = JSON.parse(res.content![0].text!)
    expect(parsed.ok).toBe(true)
    expect(Array.isArray(parsed.data)).toBe(true)
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true })
  }
})
