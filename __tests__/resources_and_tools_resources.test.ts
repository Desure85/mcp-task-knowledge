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
test('tools via RPC: project_get_current and tasks_list execution using tools_run (resources-only mode)', async () => {
  const { dataDir, project, taskId } = await createTestDataDir()
  const client = await createClient({
    DATA_DIR: dataDir,
    CURRENT_PROJECT: project,
    EMBEDDINGS_MODE: 'none',
    MCP_TOOLS_ENABLED: 'false',
    MCP_TOOL_RESOURCES_ENABLED: 'true',
    // MCP_TOOL_RESOURCES_EXEC no longer needed; execution is via tools_run
  })
  try {
    // Schema via tool resource wrapper
    const schemaRes = await client.readResource({ uri: 'tool://project_get_current' })
    const schemaJson = JSON.parse(schemaRes.contents![0].text!)
    expect(schemaJson?.name).toBe('project_get_current')

    // Execute project_get_current via tools_run (RPC)
    const r1 = await client.callTool({
      name: 'tools_run',
      arguments: { name: 'project_get_current', params: {} },
    })
    const r1Text = r1.content?.[0]?.text || '{}'
    const r1Json = JSON.parse(r1Text)
    expect(r1Json?.ok).toBe(true)
    expect(r1Json?.data?.results?.[0]?.ok).toBe(true)
    // project field may be placed inside nested data
    const proj = r1Json?.data?.results?.[0]?.data?.project ?? r1Json?.data?.results?.[0]?.data?.name ?? r1Json?.data?.results?.[0]?.data
    expect(proj).toBeDefined()

    // Execute tasks_list via tools_run (explicit project)
    const r2 = await client.callTool({
      name: 'tools_run',
      arguments: { name: 'tasks_list', params: { project } },
    })
    const r2Text = r2.content?.[0]?.text || '{}'
    const r2Json = JSON.parse(r2Text)
    expect(r2Json?.ok).toBe(true)
    expect(r2Json?.data?.results?.[0]?.ok).toBe(true)
    let list: any = r2Json?.data?.results?.[0]?.data
    // unwrap nested shapes if needed
    if (!Array.isArray(list) && list && typeof list === 'object' && Array.isArray(list.data)) {
      list = list.data
    }
    if (!Array.isArray(list) && typeof list === 'string') {
      try { const parsed = JSON.parse(list); if (Array.isArray(parsed)) list = parsed } catch {}
    }
    expect(Array.isArray(list)).toBe(true)
    const hasTask = (list as any[]).some((t: any) => t.id === taskId)
    expect(hasTask).toBe(true)
  } finally {
    await client.close()
    await fs.promises.rm(dataDir, { recursive: true, force: true })
  }
})
