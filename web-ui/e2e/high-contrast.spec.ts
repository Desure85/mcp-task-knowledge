import { expect, test } from '@playwright/test';

const ROUTES = [
  '/', '/tasks', '/knowledge', '/prompts', '/search', '/analytics',
  '/graph', '/memory', '/projects', '/projects/settings', '/system', '/access',
] as const;

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';
let token = '';

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for high-contrast').toBe(true);
  token = ((await response.json()) as { token: string }).token;
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => {
    sessionStorage.setItem('mcp.auth.token', value);
    localStorage.setItem('mcp.theme', 'high-contrast');
    localStorage.setItem('mcp.mode', 'dark');
  }, token);
});

for (const route of ROUTES) {
  test(`UI-23: ${route} renders with high-contrast from the first paint`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(await page.locator('html').getAttribute('data-theme')).toBe('high-contrast');
    expect(await page.locator('html').getAttribute('data-mode')).toBe('dark');
    await expect(page.locator('main h1')).toBeVisible();
  });
}
