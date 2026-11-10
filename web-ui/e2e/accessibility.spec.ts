import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
  const response = await request.post(`${MCP_URL}/auth/login`, {
    data: { username: USER, password: PASSWORD },
  });
  expect(response.ok(), `login to ${MCP_URL} as ${USER}`).toBe(true);
  const body = (await response.json()) as { ok?: boolean; token?: string };
  expect(body.ok).toBe(true);
  expect(typeof body.token).toBe('string');
  token = body.token!;
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => {
    sessionStorage.setItem('mcp.auth.token', value);
  }, token);
});

for (const route of ROUTES) {
  test(`axe: ${route} has no critical or serious WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    const details = serious
      .map((v) => `${v.id} [${v.impact}] ${v.nodes.length} node(s): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(serious, details).toEqual([]);
  });
}

for (const route of ['/knowledge', '/tasks', '/graph']) {
  test(`keyboard: Tab reaches a control inside main on ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const reached = await tabIntoMain(page);
    expect(reached, `Tab did not reach main content on ${route}`).toBe(true);
  });
}

async function tabIntoMain(page: Page): Promise<boolean> {
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const main = document.querySelector('main');
      return Boolean(active && main && active !== document.body && main.contains(active));
    });
    if (inside) return true;
  }
  return false;
}
