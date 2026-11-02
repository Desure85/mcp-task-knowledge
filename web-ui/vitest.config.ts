import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the Next.js `@/…` alias so component tests can import primitives.
  resolve: { alias: { '@': __dirname } },
  test: {
    // Keep the web-ui suite self-contained — never pick up the repo-root
    // vitest.config.ts or the MCP server tests.
    root: __dirname,
    include: ['lib/**/*.test.ts', 'app/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
