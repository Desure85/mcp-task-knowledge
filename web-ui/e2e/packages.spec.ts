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
  expect(response.ok(), 'login for packages').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'z03-e2e', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });
});

test.afterAll(async () => {
  await client?.close();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

test('Z-03: open a package, edit a file and toggle a plugin component', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const skillName = `z03-skill-${stamp}`;
  const pluginName = `z03-plugin-${stamp}`;
  const skillFile = 'notes/readme.md';

  await tool('package_create', {
    kind: 'skill',
    name: skillName,
    files: [
      { path: 'SKILL.md', content: '# Z-03 skill\n' },
      { path: skillFile, content: 'old notes' },
    ],
  });
  await tool('package_create', {
    kind: 'plugin',
    name: pluginName,
    files: [
      { path: 'skills/one/SKILL.md', content: '# one\n' },
      { path: 'commands/run.md', content: 'run\n' },
    ],
  });

  await page.goto('/packages', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: new RegExp(skillName) }).click();
  await expect(page.getByRole('tree', { name: `${skillName} files` })).toBeVisible();
  await page.getByRole('button', { name: /readme\.md/ }).click();
  const editor = page.getByRole('textbox', { name: 'File content' });
  await editor.fill('updated notes');
  await page.getByRole('button', { name: 'Save file' }).click();
  await expect(page.getByText(`Saved ${skillFile}.`)).toBeVisible();
  const saved = await tool<{ files: Array<{ path: string; content: string | null }> }>('package_get', { kind: 'skill', name: skillName });
  expect(saved.files.find((file) => file.path === skillFile)?.content).toBe('updated notes');

  await page.getByRole('button', { name: new RegExp(pluginName) }).click();
  await expect(page.getByText('Components', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disable' }).first().click();
  await expect(page.getByText('disabled', { exact: true }).first()).toBeVisible();
  const plugin = await tool<{ disabledComponents: string[] }>('package_get', { kind: 'plugin', name: pluginName });
  expect(plugin.disabledComponents).toContain('skills');
});

