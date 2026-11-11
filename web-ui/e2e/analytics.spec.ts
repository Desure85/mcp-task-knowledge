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
  expect(response.ok(), 'login for analytics').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui18-e2e', version: '1.0.0' });
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

test('UI-18: analytics shows throughput chart with day/week switch and a ≥10 event feed', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const created: string[] = [];
  for (let i = 0; i < 12; i++) {
    const task = await tool<{ id: string }>('tasks_create', {
      project,
      title: `UI18-analytics-${stamp}-${i}`,
      priority: i % 2 === 0 ? 'high' : 'low',
    });
    created.push(task.id);
  }
  for (const id of created.slice(0, 3)) await tool('tasks_close', { project, id });

  const toolCalls: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/mcp') || request.method() !== 'POST') return;
    try {
      const body = request.postDataJSON() as { params?: { name?: string } };
      if (body?.params?.name) toolCalls.push(body.params.name);
    } catch {
      // MCP batch/non-JSON request; not relevant to the analytics assertions.
    }
  });

  await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Throughput', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent activity', exact: true })).toBeVisible();
  await expect(page.getByTestId('analytics-chart')).toBeVisible();
  await expect(page.getByRole('img', { name: /Task throughput:/ })).toBeVisible();
  await expect.poll(() => toolCalls.filter((name) => name === 'dashboard_trends').length).toBeGreaterThan(0);
  await expect.poll(() => toolCalls.filter((name) => name === 'dashboard_activity').length).toBeGreaterThan(0);

  const feed = page.getByRole('list', { name: 'Recent activity' });
  await expect(feed).toBeVisible();
  expect(await feed.getByRole('listitem').count()).toBeGreaterThanOrEqual(10);

  const daily = page.getByRole('button', { name: 'Daily', exact: true });
  const weekly = page.getByRole('button', { name: 'Weekly', exact: true });
  await expect(daily).toHaveAttribute('aria-pressed', 'true');
  await weekly.click();
  await expect(weekly).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => toolCalls.filter((name) => name === 'dashboard_trends').length).toBeGreaterThan(1);
  await page.getByRole('button', { name: '7d', exact: true }).click();
  await expect(page.getByRole('button', { name: '7d', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: /over 7 days/ })).toBeVisible();

  await tool('tasks_bulk_trash', { project, ids: created });
  const remaining = await tool<Array<{ id: string }>>('tasks_list', { project, limit: 100 });
  await tool('tasks_bulk_trash', { project, ids: remaining.map((task) => task.id) });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('No analytics yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a task', exact: true })).toBeVisible();
});
