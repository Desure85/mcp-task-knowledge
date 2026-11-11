import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let client: Client;
let token = '';
let staleTitle = '';
let unlinkedTitle = '';
const createdIds: string[] = [];

async function tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '{}';
  const env = JSON.parse(text) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!env.ok) throw new Error(`${name}: ${env.error?.message ?? 'unknown'}`);
  return env.data as T;
}

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for knowledge health').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui32-e2e', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });

  const suffix = Date.now().toString(36);
  staleTitle = `stale anchor src/definitely-missing-${suffix}.ts`;
  unlinkedTitle = `Unlinked health doc ${suffix}`;
  const created = await tool<{ created: Array<{ id: string }> }>('knowledge_bulk_create', {
    project: 'mcp',
    items: [
      { title: staleTitle, content: 'Anchored to a file that does not exist.', type: 'memory_fact', tags: ['ui32-health'] },
      { title: unlinkedTitle, content: 'Neither parent nor children.', type: 'note', tags: ['ui32-health'] },
    ],
  });
  createdIds.push(...created.created.map((doc) => doc.id));
});

test.afterAll(async () => {
  try {
    if (createdIds.length) await tool('knowledge_bulk_trash', { project: 'mcp', ids: createdIds });
  } catch {
    // Best-effort cleanup on an isolated E2E data dir.
  }
  await client?.close();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

test('UI-32: stale facts and unlinked documents are listed with actions', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Knowledge health', exact: true })).toBeVisible();

  const staleLink = page.getByRole('link', { name: staleTitle, exact: true }).first();
  await expect(staleLink).toBeVisible();
  await expect(staleLink).toHaveAttribute('href', /\/knowledge\?doc=/);
  await expect(page.getByText('stale', { exact: true }).first()).toBeVisible();

  const unlinkedLink = page.getByRole('link', { name: unlinkedTitle, exact: true }).first();
  await expect(unlinkedLink).toBeVisible();
  await expect(unlinkedLink).toHaveAttribute('href', /\/knowledge\?doc=/);
  await expect(page.getByRole('link', { name: 'Связать', exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Проверить', exact: true }).first().click();
  await expect(page.getByRole('status')).toContainText('memory_verify');
});
