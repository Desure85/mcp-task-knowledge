import os from 'node:os';
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

/**
 * TS-01: hard ceiling on parallel workers.
 *
 * An uncapped `vitest run` on a many-core host spawns one worker per core. Each
 * worker holds its own copy of the server modules (~0.9 GB), so a 72-core box
 * reached ~60 GB and the OOM killer rebooted the machine. The same uncapped run
 * is executed by `npm test` and `.husky/pre-push`, so the ceiling lives in the
 * config (authoritative for every entry point) and can be raised deliberately
 * with `VITEST_MAX_WORKERS` without editing files.
 */
export function resolveMaxWorkers(
  cores: number = os.availableParallelism?.() ?? os.cpus().length,
  raw: string | undefined = process.env.VITEST_MAX_WORKERS,
): number {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

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
    // TS-01: never spawn more than the safe ceiling (see resolveMaxWorkers).
    maxWorkers: resolveMaxWorkers(),
    // Exclude non-project test directories from discovery
    exclude: [
      'service-catalog/**',
      'node_modules/**',
      '**/node_modules/**',
      'web-ui/**',
      '.opencode/**',
      'dist/**',
      ...(hasSqliteBinding() ? [] : SQLITE_SPECS),
    ],
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/support/orphan-guard.ts'],
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
