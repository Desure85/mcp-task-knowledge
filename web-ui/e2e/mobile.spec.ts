import { expect, test, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROUTES = [
  '/',
  '/tasks',
  '/knowledge',
  '/prompts',
  '/search',
  '/analytics',
  '/graph',
  '/memory',
  '/projects',
  '/projects/settings',
  '/system',
  '/access',
] as const;

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let token = '';
let client: Client | undefined;
let currentProject = 'mcp';
const createdTaskIds: string[] = [];

async function tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client!.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '{}';
  const env = JSON.parse(text) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!env.ok) throw new Error(`${name}: ${env.error?.message ?? 'unknown'}`);
  return env.data as T;
}

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for mobile contract').toBe(true);
  token = ((await response.json()) as { token: string }).token;

  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui20-mobile', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });
  const projects = await tool<{ current?: string }>('project_list', {});
  currentProject = projects.current ?? 'mcp';
  for (const title of ['Mobile card Alpha', 'Mobile card Beta']) {
    const task = await tool<{ id: string }>('tasks_create', { project: currentProject, title });
    createdTaskIds.push(task.id);
  }
});

test.afterAll(async () => {
  try {
    if (client && createdTaskIds.length) await tool('tasks_bulk_trash', { project: currentProject, ids: createdTaskIds });
  } catch {
    // Best-effort cleanup on an isolated E2E data dir.
  }
  await client?.close();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(overflow.document, 'document horizontal overflow').toBeLessThanOrEqual(1);
  expect(overflow.body, 'body horizontal overflow').toBeLessThanOrEqual(1);
}

async function expectTouchTargets(page: Page): Promise<void> {
  const small = await page.evaluate(() => {
    const selector =
      'a[href]:not(.sr-only), button:not([disabled]), input:not([type="hidden"]):not(.sr-only), select, textarea, [role="button"], [role="menuitemradio"], summary';
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 43.5 || rect.height < 43.5);
      })
      .slice(0, 8)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      });
  });
  expect(small, `tap targets below 44px: ${small.join('; ')}`).toEqual([]);
}

test.use({ viewport: { width: 390, height: 844 } });

test('UI-20: mobile menu opens/closes and keeps the active section visible', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const primary = page.getByRole('navigation', { name: 'Primary' });
  await expect(primary).toBeVisible();
  await expect(primary).toContainText('Overview');

  await primary.getByRole('button', { name: 'Menu', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Navigation', exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  await primary.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(primary).toContainText('Tasks');
});

for (const route of ROUTES) {
  test(`UI-20: ${route} fits 390x844 with 44px touch targets`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main h1')).toBeVisible();
    if (route === '/tasks') {
      await page.getByRole('button', { name: /^list$/i }).click();
      const cardRow = page.locator('table[data-mobile-cards] tbody tr').first();
      await expect(cardRow).toBeVisible();
      expect(await cardRow.evaluate((el) => getComputedStyle(el).display)).toBe('block');
      await expect(page.getByText('Mobile card Alpha', { exact: true })).toBeVisible();
      expect(await page.locator('table[data-mobile-cards] td[data-label="Task"]').count()).toBeGreaterThan(0);
    }
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
  });
}

test('UI-20: 768x1024 keeps the mobile chrome without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  for (const route of ['/', '/tasks', '/system']) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main h1')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
});
