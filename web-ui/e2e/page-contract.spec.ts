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
  '/projects/settings',
  '/system',
  '/access',
] as const;

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let token = '';

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for page contract').toBe(true);
  token = ((await response.json()) as { token: string }).token;
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

for (const route of ROUTES) {
  test(`page contract: ${route} has one h1 and an active nav item`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    const h1 = page.locator('main h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();

    const active = page.locator('aside a[aria-current="page"]');
    await expect(active).toHaveCount(1);
    const expectedHref = route === '/' ? '/' : route;
    await expect(active).toHaveAttribute('href', expectedHref);

    // Screenshot comparison is scoped to the heading, so page data does not
    // leak into the baseline. Tolerance covers platform font antialiasing.
    await expect(h1).toHaveScreenshot(`h1-${route === '/' ? 'overview' : route.replaceAll('/', '-').slice(1)}.png`, {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.15,
    });
  });
}

test('page contract: skip link focuses main', async ({ page }) => {
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveText(/Skip to content/);
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('page contract: Overview is reachable from the menu', async ({ page }) => {
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await page.locator('aside').getByRole('link', { name: 'Overview' }).click();
  await expect(page).toHaveURL(/\/$/);
});
