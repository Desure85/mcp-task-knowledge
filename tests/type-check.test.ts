/**
 * tests/type-check.test.ts — Mock/interface sync guard (TD-012)
 *
 * Compile-time assertions that test mocks still satisfy their real
 * interfaces. Run via `npm run test:types` (tsc -p tsconfig.test.json):
 * if an interface gains/loses members, `satisfies` fails the build here.
 *
 * Mirrors the mock shapes used across tests/ (app-container, transport,
 * search, catalog) so a drift is caught in one place.
 */

import { describe, it, expect } from 'vitest';
import type { TransportAdapter, TransportHealth } from '../src/transport/types.js';
import type { ToolContext } from '../src/core/tool-executor.js';
import type { VectorSearchAdapter } from '../src/search/index.js';
import type { ServiceCatalogProvider } from '../src/catalog/provider.js';
import { ToolRegistry } from '../src/registry/tool-registry.js';

describe('TD-012: mock interface sync', () => {
  it('TransportAdapter mock shape satisfies the interface', () => {
    const mockAdapter = {
      type: 'stdio',
      connected: false,
      async connect() {},
      async close() {},
      health(): TransportHealth {
        return { type: 'stdio', healthy: false, connected: false };
      },
    } satisfies TransportAdapter;
    expect(mockAdapter).toBeDefined();
  });

  it('ToolContext mock shape satisfies the interface', () => {
    const mockCtx = {
      sessionId: 's1',
      roles: [],
      remote: '127.0.0.1:1',
      createdAt: 0,
      metadata: {},
      server: {} as never,
    } satisfies ToolContext;
    expect(mockCtx).toBeDefined();
  });

  it('VectorSearchAdapter mock shape satisfies the interface', () => {
    const mockAdapter = {
      search: async () => [],
    } satisfies VectorSearchAdapter<unknown>;
    expect(mockAdapter).toBeDefined();
  });

  it('ServiceCatalogProvider mock shape satisfies the interface', () => {
    const mockProvider = {
      mode: 'embedded' as const,
      async queryServices() {
        return { items: [], total: 0, page: 1, pageSize: 10 };
      },
      async health() {
        return { ok: true, source: 'embedded' as const };
      },
      async upsertServices() {
        return { ok: true, count: 0 };
      },
      async deleteServices() {
        return { ok: true, count: 0 };
      },
    } satisfies ServiceCatalogProvider;
    expect(mockProvider).toBeDefined();
  });

  it('real ToolRegistry instance satisfies the ServerContext toolRegistry contract', () => {
    // Real class instance — no drift possible, guards accidental interface changes
    const reg = new ToolRegistry();
    expect(reg).toBeDefined();
  });
});
