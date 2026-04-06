import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude service-catalog from tests
    exclude: ['service-catalog/**'],
    setupFiles: ['./tests/setup.ts'],
  },
});
