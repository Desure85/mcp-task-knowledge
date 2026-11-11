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
  expect(response.ok(), 'login for knowledge tree').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui25-tree', version: '1.0.0' });
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

test('UI-25: knowledge tree nests documents and shows the breadcrumb', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const parentTitle = `UI25-doc-parent-${stamp}`;
  const childTitle = `UI25-doc-child-${stamp}`;
  const created = await tool<{ created: Array<{ id: string; title: string }> }>('knowledge_bulk_create', {
    project,
    items: [
      { title: parentTitle, content: 'parent body' },
      { title: childTitle, content: 'child body' },
    ],
  });
  const parent = created.created.find((doc) => doc.title === parentTitle)!;
  const child = created.created.find((doc) => doc.title === childTitle)!;
  await tool('knowledge_bulk_update', {
    project,
    items: [{ id: child.id, parentId: parent.id }],
  });

  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/mcp')) bodies.push(request.postData() ?? '');
  });
  await page.goto('/knowledge', { waitUntil: 'domcontentloaded' });
  await page.getByRole('group', { name: 'Knowledge view' }).getByRole('button', { name: 'Tree' }).click();
  await expect(page.getByRole('tree', { name: 'Knowledge document tree' })).toBeVisible();
  await page.getByRole('button', { name: `Expand ${parentTitle}` }).click();
  await page.getByRole('button', { name: childTitle, exact: true }).click();

  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb).toContainText(parentTitle);

  await tool('knowledge_bulk_trash', { project, ids: [child.id, parent.id] });
});


test('UI-30 hotfix: opening task editor in a new tab keeps the login', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const stamp = Date.now().toString(36);
  const title = `UI-hotfix-newtab-${stamp}`;
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[autocomplete="username"]').fill(USER);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByPlaceholder('Task title…').fill(title);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();

  const [editor] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: title, exact: true }).click(),
  ]);
  await editor.waitForLoadState('domcontentloaded');
  await expect(editor).not.toHaveURL(/\/login/);
  await expect(editor.getByRole('heading', { level: 1 })).toHaveText(title);
  await context.close();
});
