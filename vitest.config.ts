import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude non-project test directories from discovery
    exclude: [
      'service-catalog/**',
      'node_modules/**',
      '.opencode/**',
      'dist/**',
    ],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      // Q-005: enforce ≥80% statements on src/ (run: `npm run test:coverage`)
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Tool registrars: thin wiring, covered by E2E (Q-004), not unit tests
        'src/register/**',
        // Catalog provider: covered by integration tests in tests/catalog.*.test.ts
        'src/catalog/**',
        // ONNX vector adapter: hardware-dependent, requires model files (EMBEDDINGS_MODE)
        'src/search/vector.ts',
        'src/**/index.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
