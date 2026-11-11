import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let client: Client;
let token = '';
let project = '';

async function tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '{}';
  const env = JSON.parse(text) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!env.ok) throw new Error(`${name}: ${env.error?.message ?? 'unknown'}`);
  return env.data as T;
}

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for entity card').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui30-e2e', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });
  project = (await tool<{ project: string }>('project_get_current')).project;
});

test.afterAll(async () => {
  await client?.close();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

test('UI-30: entity card shows related tasks/documents and opens from graph, task and document', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const entity = `UI30Entity${stamp}`;
  const task = await tool<{ id: string }>('tasks_create', { project, title: `${entity} task` });
  const docs = await tool<{ created: Array<{ id: string }> }>('knowledge_bulk_create', {
    project,
    items: [{ title: `${entity} document`, content: `Notes about ${entity}` }],
  });
  const doc = docs.created[0];
  await tool('memory_temporal_add', {
    statement: `${entity} is used by the release checklist`,
    entities: [entity],
  });

  await page.goto(`/graph?entity=${encodeURIComponent(entity)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: entity, exact: true })).toBeVisible();
  await expect(page.getByText('Related work')).toBeVisible();
  await expect(page.getByRole('link', { name: `${entity} task`, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `${entity} document`, exact: true })).toBeVisible();

  await page.getByRole('link', { name: `${entity} task`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await page.getByRole('link', { name: 'Open in graph' }).click();
  await expect(page).toHaveURL(new RegExp(`/graph\\?entity=${encodeURIComponent(entity)}`));
  await expect(page.getByRole('heading', { name: entity, exact: true })).toBeVisible();

  await page.goto(`/knowledge?doc=${doc.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: `${entity} document` })).toBeVisible();
  await page.getByRole('link', { name: 'Open in graph' }).click();
  await expect(page).toHaveURL(new RegExp(`/graph\\?entity=${encodeURIComponent(entity)}`));
  await expect(page.getByRole('heading', { name: entity, exact: true })).toBeVisible();

  await tool('tasks_bulk_trash', { project, ids: [task.id] });
  await tool('knowledge_bulk_trash', { project, ids: [doc.id] });
});
