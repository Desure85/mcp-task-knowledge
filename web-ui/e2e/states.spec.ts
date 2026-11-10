import { expect, test } from '@playwright/test';

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
  '/system',
  '/access',
] as const;

const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

for (const route of ROUTES) {
  test(`offline: ${route} shows one error with Retry, never an empty state`, async ({ page }) => {
    await page.route('**/mcp**', (request) => request.abort('failed'));
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    const alert = page.locator('main').getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Server unavailable');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    // The shell must not render page children while the API is unreachable.
    await expect(page.locator('main')).not.toContainText('No tasks');
    await expect(page.locator('main')).not.toContainText('No documents');
    await expect(page.locator('main')).not.toContainText('No projects');
  });
}

test('expired JWT redirects to login with banner and returns to next', async ({ page }) => {
  await page.addInitScript(() => {
    // Header + payload {"exp":1} + signature; decodeJwtClaims only reads the payload.
    sessionStorage.setItem('mcp.auth.token', 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.demo');
  });
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login\?.*expired=1/);
  await expect(page.getByRole('status')).toContainText('Session expired');

  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
});
