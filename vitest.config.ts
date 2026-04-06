import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude non-project test directories from discovery
    exclude: [
      'service-catalog/**',
      'node_modules/**',
      'dist/**',
    ],
    setupFiles: ['./tests/setup.ts'],
  },
});
