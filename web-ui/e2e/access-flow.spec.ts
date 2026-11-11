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
  expect(response.ok(), 'login for access flow').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui21-e2e', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });
});

test.afterAll(async () => {
  await client?.close();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('UI-21: connect an agent through the five-step flow and verify the connection', async ({ page }) => {
  await page.goto('/access', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Access & tokens', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1. Создайте одноразовую ссылку', exact: true })).toBeVisible();
  await expect(page.getByText('5. Передайте конфиг агенту.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Создать ссылку', exact: true }).click();
  await expect(page.getByText(/\.well-known\/mcp-setup\//)).toBeVisible();

  await page.getByRole('button', { name: '2. Получить конфиг', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '2–4. Конфиг агента', exact: true })).toBeVisible();
  const snippet = page.locator('pre code');
  await expect(snippet).toContainText('mcpServers');
  await expect(snippet).toContainText('Authorization');
  await expect(snippet).toContainText(/Bearer /);

  await page.getByRole('button', { name: 'Copy config', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('mcpServers');
  expect(copied).toContain('Authorization');

  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Подключение работает');

  await page.route('**/api/setup/check', (route) => route.abort());
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось проверить подключение' })).toBeVisible();
});
