import { expect, test, type Page } from '@playwright/test';

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let token = '';

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for tasks list').toBe(true);
  token = ((await response.json()) as { token: string }).token;
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

async function createTask(page: Page, title: string, priority: 'high' | 'medium' | 'low') {
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByPlaceholder('Task title…').fill(title);
  await page.locator('select[aria-label="Priority"]').first().selectOption(priority);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}

async function openList(page: Page) {
  await page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'list', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'list', exact: true })).toHaveAttribute('aria-pressed', 'true');
}

test('UI-16: list view persists and priority sorting reorders rows', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const high = `ZZ-high-${stamp}`;
  const low = `ZZ-low-${stamp}`;
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await createTask(page, high, 'high');
  await createTask(page, low, 'low');
  await openList(page);

  const titles = () => page.locator('tbody tr td:nth-child(2) button').allTextContents();
  const order = await titles();
  expect(order.indexOf(high)).toBeLessThan(order.indexOf(low));

  await page.getByRole('button', { name: /^Priority/ }).click();
  const reversed = await titles();
  expect(reversed.indexOf(low)).toBeLessThan(reversed.indexOf(high));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'list', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: high, exact: true })).toBeVisible();
});

test('UI-16: select three tasks and close all three', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const titles = [`ZZ-bulk-a-${stamp}`, `ZZ-bulk-b-${stamp}`, `ZZ-bulk-c-${stamp}`];
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  for (const title of titles) await createTask(page, title, 'medium');
  await openList(page);

  for (const title of titles) await page.getByLabel(`Select ${title}`).check();
  await expect(page.getByText('3 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Close selected' }).click();
  await expect(page.getByText('0 selected')).toBeVisible();

  for (const title of titles) {
    const row = page.locator('tr', { hasText: title });
    await expect(row).toContainText(/closed|done/i);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'list', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const title of titles) {
    const row = page.locator('tr', { hasText: title });
    await expect(row).toContainText(/closed|done/i);
  }
});


test('UI-38/36: list row free area opens preview, task name opens full editor in a new tab', async ({ page, context }) => {
  const stamp = Date.now().toString(36);
  const title = `ZZ-row-click-${stamp}`;
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await createTask(page, title, 'medium');
  await openList(page);

  const row = page.locator('tbody tr', { hasText: title });
  await row.locator('td').nth(2).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  const [editor] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: title, exact: true }).click(),
  ]);
  await editor.waitForLoadState('domcontentloaded');
  await expect(editor).toHaveURL(/\/tasks\/[^/]+$/);
  await editor.close();
});
