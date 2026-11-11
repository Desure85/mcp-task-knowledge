import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'node:path';

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
  expect(response.ok(), 'login for quick view').toBe(true);
  token = ((await response.json()) as { token: string }).token;
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui36-e2e', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });
  const current = await tool<{ project: string }>('project_get_current');
  project = current.project;
});

test.afterAll(async () => {
  await client?.close();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

test('UI-36: card opens a read-only quick view with full details', async ({ page, context }) => {
  const stamp = Date.now().toString(36);
  const title = `UI36-card-${stamp}`;
  const description = `First line ${stamp}\nSecond line is deliberately long so the card truncates it but the dialog must not.\nThird line.`;
  const parent = await tool<{ id: string }>('tasks_create', {
    project,
    title,
    description,
    priority: 'high',
    tags: ['ui36', 'detail'],
    links: ['https://example.com/spec'],
  });
  const child = await tool<{ id: string }>('tasks_create', {
    project,
    title: `UI36-child-${stamp}`,
    parentId: parent.id,
  });
  // SQLite profile ignores dependsOn on create; persist it through update for both profiles.
  await tool('tasks_update', { project, id: parent.id, dependsOn: [child.id] });
  let claimSupported = true;
  try {
    await tool('tasks_claim', { project, id: parent.id, client: 'web-ui-e2e' });
  } catch {
    claimSupported = false; // SQLite profile does not implement claims yet (Y-05a2 gap).
  }

  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  // The name opens the inline editor; the card's free area opens the preview.
  await page.locator(`[data-task="${parent.id}"]`).click({ position: { x: 6, y: 6 } });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(description);
  await expect(dialog).toContainText('ui36');
  await expect(dialog).toContainText('https://example.com/spec');
  await expect(dialog).toContainText(`UI36-child-${stamp}`);
  await expect(dialog).toContainText('Blocks');
  if (claimSupported) await expect(dialog).toContainText('Claimed by web-ui-e2e');
  else await expect(dialog).toContainText('No active lease');
  await expect(dialog.locator('input, textarea, select')).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.resolve('..', 'docs/ui/screens/ui-36/quick-view-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.resolve('..', 'docs/ui/screens/ui-36/quick-view-390.png'), fullPage: true });
  // UI-20: restore the desktop viewport before continuing to interact with the board;
  // at 390 the sticky mobile chrome covers the card's top-left click point.
  await page.setViewportSize({ width: 1440, height: 900 });

  // Related tasks stay inside the preview instead of navigating away.
  await dialog.getByRole('button', { name: `UI36-child-${stamp}`, exact: true }).first().click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(dialog.getByRole('heading', { name: `UI36-child-${stamp}`, exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator(`[data-task="${parent.id}"]`)).toBeFocused();

  const [editorPage] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: title, exact: true }).click(),
  ]);
  await editorPage.waitForLoadState('domcontentloaded');
  await expect(editorPage).toHaveURL(new RegExp(`/tasks/${parent.id}$`));
  await editorPage.close();

  await page.locator(`[data-task="${parent.id}"]`).click({ position: { x: 6, y: 6 } });
  const reopened = page.getByRole('dialog');
  await expect(reopened).toBeVisible();
  const [fullPage] = await Promise.all([
    context.waitForEvent('page'),
    reopened.getByRole('button', { name: 'Edit' }).click(),
  ]);
  await fullPage.waitForLoadState('domcontentloaded');
  await expect(fullPage).toHaveURL(new RegExp(`/tasks/${parent.id}$`));
  await fullPage.close();

  await tool('tasks_bulk_trash', { project, ids: [parent.id, child.id] });
});
