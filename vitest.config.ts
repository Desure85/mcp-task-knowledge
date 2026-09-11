import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

// PH-010: probe native deps so specs that import better-sqlite3 at module
// level are skipped (not crashed) when the binding was never built — e.g.
// `npm ci --ignore-scripts` containers. In CI the binding exists and the
// specs run normally.
function hasSqliteBinding(): boolean {
  try {
    const req = createRequire(import.meta.url);
    const Database = req('better-sqlite3') as new (p: string) => { close(): void };
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}
const SQLITE_SPECS = ['src/behavioral/fts-search.spec.ts', 'src/db/migration-framework.spec.ts'];

export default defineConfig({
  test: {
    // Exclude non-project test directories from discovery
    exclude: [
      'service-catalog/**',
      'node_modules/**',
      '.opencode/**',
      'dist/**',
      ...(hasSqliteBinding() ? [] : SQLITE_SPECS),
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
