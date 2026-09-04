/**
 * tests/e2e-full/memory-pipeline.test.ts — Q-014 slice 3: memory pipeline e2e.
 *
 * extract (persist) → facts_list → facts_search → temporal add/query →
 * entity search — all through a real hermetic server.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

const TRANSCRIPT =
  'User decided to use Postgres for the session store because it supports JSONB well. ' +
  'I prefer dark mode in the editor and tabs over spaces for Python files. ' +
  'We fixed the login bug by rotating the expired refresh token secret.';

describe('Q-014 slice 3: memory extraction pipeline', () => {
  it('extract persist → list → search roundtrip', async () => {
    const srv = await spawnServer('memory-pipeline');
    try {
      const ext = await srv.callTool('memory_extract', {
        transcript: TRANSCRIPT,
        project: 'mcp',
        persist: true,
      });
      expect(ext.isError).toBe(false);
      expect(ext.env.ok).toBe(true);
      expect(ext.env.data.factsExtracted).toBeGreaterThan(0);
      expect(ext.env.data.persistedCount).toBeGreaterThan(0);

      const list = await srv.callTool('memory_facts_list', { project: 'mcp', limit: 50 });
      expect(list.env.ok).toBe(true);
      expect(list.env.data.count).toBeGreaterThanOrEqual(ext.env.data.persistedCount);

      const search = await srv.callTool('memory_facts_search', {
        project: 'mcp',
        query: 'Postgres',
      });
      expect(search.env.ok).toBe(true);
      expect(search.env.data.count).toBeGreaterThanOrEqual(1);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 3: temporal graph roundtrip', () => {
  it('temporal_add → query → invalidate hides the fact', async () => {
    const srv = await spawnServer('memory-temporal');
    try {
      const added = await srv.callTool('memory_temporal_add', {
        statement: 'Q014 temporal fact about cache TTL',
        category: 'decision',
      });
      expect(added.isError).toBe(false);
      expect(added.env.ok).toBe(true);
      const factId = added.env.data.id ?? added.env.data.fact?.id;
      expect(typeof factId).toBe('string');

      const q = await srv.callTool('memory_temporal_query', { entity: 'cache' });
      expect(q.env.ok).toBe(true);

      const inv = await srv.callTool('memory_temporal_invalidate', { factId, reason: 'q014' });
      expect(inv.isError).toBe(false);

      const after = await srv.callTool('memory_temporal_query', {});
      expect(after.env.ok).toBe(true);
      const ids = JSON.stringify(after.env.data);
      expect(ids).not.toContain(factId);
    } finally {
      await srv.close();
    }
  }, 120000);
});
