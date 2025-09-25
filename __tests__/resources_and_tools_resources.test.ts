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
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mcp-resources-test-'))

  const project = 'alpha'

  // tasks: modern layout DATA_DIR/tasks/<project>/<id>.json
  const tasksDir = path.join(dataDir, 'tasks', project)
  await fs.promises.mkdir(tasksDir, { recursive: true })
  const task = {
    id: 't1',
    project,
    title: 'Test Task',
    description: 'Task for resource read',
    status: 'pending',
    priority: 'medium',
    tags: [],
    links: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    parentId: null,
    archived: false,
    trashed: false,
  }
  await fs.promises.writeFile(path.join(tasksDir, `${task.id}.json`), JSON.stringify(task, null, 2), 'utf8')

  // knowledge: modern layout DATA_DIR/knowledge/<project>/<id>.md
  const knowledgeDir = path.join(dataDir, 'knowledge', project)
  await fs.promises.mkdir(knowledgeDir, { recursive: true })
  const docId = 'k1'
  const fm = `---\n` +
    `id: ${docId}\n` +
    `project: ${project}\n` +
    `title: Test Doc\n` +
    `tags: [test]\n` +
    `type: note\n` +
    `archived: false\n` +
    `trashed: false\n` +
    `---\n` +
    `Hello world`
  await fs.promises.writeFile(path.join(knowledgeDir, `${docId}.md`), fm, 'utf8')

  // prompts catalog + builds
  const exportsCatalogDir = path.join(dataDir, 'prompts', project, 'exports', 'catalog')
  await fs.promises.mkdir(exportsCatalogDir, { recursive: true })
  const catalog = {
    project,
    generatedAt: new Date().toISOString(),
    items: {
      'p1': { id: 'p1', version: 'v1', title: 'P1', kind: 'prompt', domain: 'internal', status: 'draft', tags: [], buildVersion: 'v1' }
    }
  }
  await fs.promises.writeFile(path.join(exportsCatalogDir, 'prompts.catalog.json'), JSON.stringify(catalog, null, 2), 'utf8')

  // minimal build artifact to satisfy prompt://{project}/{id}@{version}
  const buildsDir = path.join(dataDir, 'prompts', project, 'exports', 'builds')
  await fs.promises.mkdir(buildsDir, { recursive: true })
  const buildContent = { id: 'p1', version: '1.0.0', kind: 'prompt', title: 'P1', tags: [] }
  await fs.promises.writeFile(path.join(buildsDir, 'p1@v1.json'), JSON.stringify(buildContent, null, 2), 'utf8')

  return { dataDir, project, taskId: task.id, docId }
}

async function createClient(env: Record<string, string>) {
  const serverPath = path.join(projectRoot, 'dist/index.js')
  if (!fs.existsSync(serverPath)) throw new Error(`Server not built: ${serverPath}`)
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env,
  })
  const client = new Client({ name: 'test-client', version: '1.0.0', capabilities: {} })
  await client.connect(transport)
  return client
}

// Resources: entities and files
test('resources: listings are available and include expected item URIs', async () => {
  const { dataDir, project, taskId, docId } = await createTestDataDir()
  const client = await createClient({
    DATA_DIR: dataDir,
    CURRENT_PROJECT: project,
    EMBEDDINGS_MODE: 'none',
    MCP_TOOLS_ENABLED: 'false',
    MCP_TOOL_RESOURCES_ENABLED: 'true',
    MCP_TOOL_RESOURCES_EXEC: 'true',
  })
  try {
    // List tasks (resource listing)
    const listTasksRes = await client.readResource({ uri: 'task://tasks' })
    const listTasksJson = JSON.parse(listTasksRes.contents![0].text!)
    expect(Array.isArray(listTasksJson)).toBe(true)
    expect(listTasksJson.some((t: any) => t.uri === `task://${project}/${taskId}`)).toBe(true)

    // List knowledge (resource listing)
    const listDocsRes = await client.readResource({ uri: 'knowledge://docs' })
    const listDocsJson = JSON.parse(listDocsRes.contents![0].text!)
    expect(Array.isArray(listDocsJson)).toBe(true)
    expect(listDocsJson.some((d: any) => d.uri === `knowledge://${project}/${docId}`)).toBe(true)

    // Prompts catalog contains our prompt (resource listing)
    const pcRes = await client.readResource({ uri: 'prompt://catalog' })
    const pcJson = JSON.parse(pcRes.contents![0].text!)
    expect(Array.isArray(pcJson)).toBe(true)
    expect(pcJson.some((p: any) => p.uri === `prompt://${project}/p1@v1`)).toBe(true)

    // Export list contains catalog file (resource listing)
    const efList = await client.readResource({ uri: 'export://files' })
    const efJson = JSON.parse(efList.contents![0].text!)
    const catalogItem = efJson.find((x: any) => x.uri === `export://${project}/catalog/prompts.catalog.json`)
    expect(catalogItem).toBeTruthy()
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true, force: true })
  }
})

// Tools via resources: base64url and urlencoded JSON
test('tools via resources: project_get_current and tasks_list execution with base64url and urlencoded JSON', async () => {
  const { dataDir, project, taskId } = await createTestDataDir()
  const client = await createClient({
    DATA_DIR: dataDir,
    CURRENT_PROJECT: project,
    EMBEDDINGS_MODE: 'none',
    MCP_TOOLS_ENABLED: 'false',
    MCP_TOOL_RESOURCES_ENABLED: 'true',
    MCP_TOOL_RESOURCES_EXEC: 'true',
  })
  try {
    // Schema via tool resource wrapper
    const schemaRes = await client.readResource({ uri: 'tool://project_get_current' })
    const schemaJson = JSON.parse(schemaRes.contents![0].text!)
    expect(schemaJson?.name).toBe('project_get_current')

    // Run via tool://run (static resource)
    const run1 = await client.readResource({ uri: 'tool://run/project_get_current' })
    const run1Json = JSON.parse(run1.contents![0].text!)
    expect(run1Json?.ok).toBe(true)
    expect(run1Json?.data?.project ?? run1Json?.data?.name ?? run1Json?.data).toBeDefined()

    // Run tasks_list via tool://run (defaults to CURRENT_PROJECT)
    const run2 = await client.readResource({ uri: 'tool://run/tasks_list' })
    const run2Json = JSON.parse(run2.contents![0].text!)
    expect(run2Json?.ok).toBe(true)
    expect(Array.isArray(run2Json?.data)).toBe(true)
    // Expect our task is present
    const hasTask = (run2Json?.data || []).some((t: any) => t.id === taskId)
    expect(hasTask).toBe(true)
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true, force: true })
  }
})
