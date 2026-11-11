import { expect, test } from '@playwright/test';

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let token = '';

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for task tree').toBe(true);
  token = ((await response.json()) as { token: string }).token;
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

test('UI-25: task list expands subtasks and creates a child with the parent preselected', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const parent = `UI25-parent-${stamp}`;
  const child = `UI25-child-${stamp}`;

  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByPlaceholder('Task title…').fill(parent);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: parent, exact: true })).toBeVisible();

  await page.getByRole('group', { name: 'Task view' }).getByRole('button', { name: 'list', exact: true }).click();
  const row = page.locator('tbody tr', { hasText: parent });
  await row.getByRole('button', { name: 'Add subtask' }).click();
  await expect(page.getByRole('combobox', { name: 'Parent task' })).not.toHaveValue('');
  await page.getByPlaceholder('Task title…').fill(child);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  const parentRow = page.locator('tbody tr', { hasText: parent });
  await parentRow.getByRole('button', { name: `Expand ${parent}` }).click();
  await expect(page.getByText(child, { exact: true })).toBeVisible();
  await expect(parentRow).toContainText('0/1');
});
