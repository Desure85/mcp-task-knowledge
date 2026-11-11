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
  expect(response.ok(), 'login for z11').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'z11-e2e', version: '1.0.0' });
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

test('Z-11: prompt target badge/filter and the agent registry page', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const claudeId = `z11-claude-${stamp}`;
  const opencodeId = `z11-opencode-${stamp}`;
  const customTarget = `z11-agent-${stamp}`;
  await tool('prompts_bulk_create', {
    project,
    items: [
      { type: 'prompt', id: claudeId, version: '1.0.0', metadata: { title: 'Claude prompt', domain: 'z11', status: 'draft', kind: 'prompt', target: 'claude', tags: [] }, template: 'Claude template', variables: [] },
      { type: 'prompt', id: opencodeId, version: '1.0.0', metadata: { title: 'OpenCode prompt', domain: 'z11', status: 'draft', kind: 'prompt', target: 'opencode', tags: [] }, template: 'OpenCode template', variables: [] },
    ],
  });

  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/mcp')) bodies.push(request.postData() ?? '');
  });
  await page.goto('/prompts', { waitUntil: 'domcontentloaded' });
  await page.getByRole('combobox', { name: 'Agent target' }).selectOption('claude');
  await expect.poll(() => bodies.some((body) => body.includes('"target":"claude"'))).toBe(true);
  await expect(page.getByRole('button', { name: `Open prompt ${claudeId}` })).toBeVisible();
  await expect(page.getByText('agent: claude', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: `Open prompt ${opencodeId}` })).toHaveCount(0);

  await page.goto('/projects/settings/agents', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Add custom target').fill(customTarget);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save registry' }).click();
  await expect(page.getByText(customTarget, { exact: true })).toBeVisible();

  await tool('project_agents_set', { project, agents: ['universal', 'claude', 'opencode'] });
});
