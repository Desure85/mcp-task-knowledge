import { defineConfig } from '@playwright/test';

/**
 * UI-15 browser gate. Runs against the built Next.js app and a real MCP server.
 * `reuseExistingServer` keeps the local demo usable; CI starts the production server.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    channel: 'chrome',
    headless: true,
    trace: 'off',
  },
  webServer: {
    command: 'npm run start -- -p 3000',
    url: 'http://127.0.0.1:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
