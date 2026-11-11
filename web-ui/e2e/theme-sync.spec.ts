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

async function waitTheme(theme: string): Promise<void> {
  await expect.poll(async () => {
    const data = await tool<{ profile: { preferences?: { theme?: string } } | null }>('profile_get', {});
    return data.profile?.preferences?.theme ?? null;
  }, { timeout: 10_000 }).toBe(theme);
}

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for theme sync').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui33a-e2e', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });
});

test.afterAll(async () => {
  await client?.close();
});

test('UI-33a: theme syncs across devices, queues offline and applies a newer server profile', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
  await contextB.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await pageA.goto('/', { waitUntil: 'domcontentloaded' });
    await pageA.getByRole('button', { name: /^Theme:/ }).click();
    await pageA.getByRole('menuitemradio', { name: 'Petrol' }).click();
    await expect(pageA.locator('html')).toHaveAttribute('data-theme', 'petrol');
    await waitTheme('petrol');

    // Second device sees the server choice after login/reconcile.
    await pageB.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(pageB.locator('html')).toHaveAttribute('data-theme', 'petrol', { timeout: 10_000 });
    expect(await pageB.evaluate(() => localStorage.getItem('mcp.theme'))).toBe('petrol');

    // Offline change is queued in one slot and pushed when the browser is online.
    await pageA.context().setOffline(true);
    await pageA.getByRole('button', { name: /^Theme:/ }).click();
    await pageA.getByRole('menuitemradio', { name: 'Copper' }).click();
    await expect.poll(() => pageA.evaluate(() => localStorage.getItem('mcp.themePending') !== null)).toBe(true);
    await pageA.context().setOffline(false);
    await waitTheme('copper');

    // A newer server-side profile wins after a reload.
    await tool('profile_set', {
      preferences: {
        version: 1,
        theme: 'indigo',
        mode: 'dark',
        customThemes: { version: 1, themes: [] },
        activeCustomId: null,
      },
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await expect(pageB.locator('html')).toHaveAttribute('data-theme', 'indigo', { timeout: 10_000 });
    expect(await pageB.evaluate(() => localStorage.getItem('mcp.theme'))).toBe('indigo');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
