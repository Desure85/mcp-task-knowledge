import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let client: Client;
let project = '';
let token = '';

async function tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '{}';
  const env = JSON.parse(text) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!env.ok) throw new Error(`${name}: ${env.error?.message ?? 'unknown'}`);
  return env.data as T;
}

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for dependencies').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui38-e2e', version: '1.0.0' });
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

test('UI-38: blockers with statuses, add/remove edge, cycle code, and DAG filters', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const blockerTitle = `UI38-blocker-${stamp}`;
  const targetTitle = `UI38-target-${stamp}`;
  const extraTitle = `UI38-extra-${stamp}`;
  const blocker = await tool<{ id: string }>('tasks_create', { project, title: blockerTitle, priority: 'high', tags: ['ui38'] });
  const target = await tool<{ id: string }>('tasks_create', { project, title: targetTitle, priority: 'high', tags: ['ui38'] });
  const extra = await tool<{ id: string }>('tasks_create', { project, title: extraTitle, priority: 'medium', tags: ['ui38'] });
  await tool('tasks_update', { project, id: blocker.id, status: 'in_progress' });
  await tool('tasks_update', { project, id: target.id, dependsOn: [blocker.id] });

  await page.goto(`/tasks/${target.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(blockerTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(/Blocked by unmet dependencies|Dependencies satisfied/)).toBeVisible();

  await page.getByRole('textbox', { name: 'Add dependency' }).fill(extraTitle);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(extraTitle, { exact: true })).toBeVisible();
  const afterAdd = await tool<{ dependsOn?: string[] }>('tasks_get', { project, id: target.id });
  expect(afterAdd.dependsOn).toEqual(expect.arrayContaining([blocker.id, extra.id]));

  // Remove extra through the UI, then make the reverse edge and try to re-add it
  // from the target page: the server must reject the cycle by code.
  const extraRow = page.locator('li', { hasText: extraTitle });
  await extraRow.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('textbox', { name: 'Add dependency' }).fill('');
  await expect(page.getByText(extraTitle, { exact: true })).toBeHidden();
  await tool('tasks_update', { project, id: extra.id, dependsOn: [target.id] });
  await page.getByRole('textbox', { name: 'Add dependency' }).fill(extraTitle);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(/DEPENDENCY_CYCLE/)).toBeVisible();
  const afterCycle = await tool<{ dependsOn?: string[] }>('tasks_get', { project, id: target.id });
  expect(afterCycle.dependsOn).toEqual([blocker.id]);

  const dagRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/mcp')) dagRequests.push(request.postData() ?? '');
  });
  await page.goto('/tasks/dag', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dependencies');
  await page.getByRole('textbox', { name: 'Tag' }).fill('ui38');
  await page.getByRole('combobox', { name: 'Limit' }).selectOption('50');
  await page.getByRole('button', { name: 'Only with dependencies' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect
    .poll(() => dagRequests.some((body) => body.includes('tasks_dag') && body.includes('ui38') && body.includes('50') && body.includes('onlyWithDeps')))
    .toBe(true);
});
