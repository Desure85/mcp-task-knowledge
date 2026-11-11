import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let client: Client;
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
  expect(response.ok(), 'login for system').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui19-e2e', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });
});

test.afterAll(async () => {
  await client?.close();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

test('UI-19: system catalog paginates/searches the tail and shows the admin sections', async ({ page }) => {
  const catalog = await tool<{ data: Array<{ name: string }>; total: number }>('tools_list', { limit: 300, offset: 0 });
  const tail = catalog.data[catalog.data.length - 1]?.name;
  expect(tail, 'catalog has a last tool').toBeTruthy();

  await page.goto('/system', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'System', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Authentication', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Access page', exact: true })).toHaveAttribute('href', '/access');

  const filter = page.getByLabel('Filter tools');
  await filter.fill(tail);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page.locator('code', { hasText: tail })).toBeVisible();
  await expect(page.getByText('No tools match')).toHaveCount(0);

  // The next page button is useless for a one-result search; state still renders.
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

  // Sessions: at most five rows, with the admin filter and dialog trigger present.
  const rows = page.getByRole('table', { name: 'Active MCP sessions' }).getByRole('row');
  expect(await rows.count()).toBeLessThanOrEqual(6); // header + 5
  await expect(page.getByLabel('Filter sessions')).toBeVisible();
  const terminate = page.getByRole('button', { name: 'Terminate', exact: true }).first();
  if (await terminate.count()) {
    await terminate.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(height).toBeLessThan(2000);
});
