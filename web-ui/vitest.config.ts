import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep the web-ui suite self-contained — never pick up the repo-root
    // vitest.config.ts or the MCP server tests.
    root: __dirname,
    include: ['lib/**/*.test.ts', 'app/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
