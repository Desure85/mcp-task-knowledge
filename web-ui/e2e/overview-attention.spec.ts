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
  expect(response.ok(), 'login for overview').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui17-e2e', version: '1.0.0' });
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

test('UI-17: overview shows attention widgets, shared knowledge metrics and an activity feed', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const blockedTitle = `UI17-blocked-${stamp}`;
  const taskTitle = `UI17-task-${stamp}`;
  const docTitle = `UI17-doc-${stamp}`;
  const tag = `ui17-${stamp}`;
  const blocked = await tool<{ id: string }>('tasks_create', { project, title: blockedTitle, priority: 'high' });
  await tool('tasks_update', { project, id: blocked.id, status: 'blocked' });
  await tool('tasks_create', { project, title: taskTitle });
  const docs = await tool<{ created: Array<{ id: string }> }>('knowledge_bulk_create', {
    project,
    items: [{ title: docTitle, content: 'overview activity', tags: [tag] }],
  });
  const doc = docs.created[0];

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Blocked tasks', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: blockedTitle, exact: true }).first()).toBeVisible();
  await expect(page.getByText('No task is claimed right now.', { exact: true })).toBeVisible();
  await expect(page.getByText('Recent activity', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: taskTitle, exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: docTitle, exact: true }).first()).toBeVisible();

  // The footer explains both KNOWLEDGE totals from the same dashboard_stats payload.
  await expect(page.getByText(/\d+ documents · \d+ unique tags · \d+ blocked as reported by dashboard_stats\./)).toBeVisible();

  // The old navigation-card grid duplicated the sidebar; no generic section card remains.
  await expect(page.getByRole('link', { name: 'Knowledge base', exact: true })).toHaveCount(0);

  await tool('tasks_bulk_trash', { project, ids: [blocked.id] });
  await tool('knowledge_bulk_trash', { project, ids: [doc.id] });
});

