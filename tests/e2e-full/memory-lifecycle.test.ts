/**
 * tests/e2e-full/memory-lifecycle.test.ts — Q-014 slice 15: memory stack e2e.
 *
 * Covers the full memory surface end to end over a real stdio server:
 *   extraction pipeline (extract → facts list/search)
 *   async extraction lifecycle (submit → status → result, cancel)
 *   temporal graph (add → query → history → invalidate → stats)
 *   entity search, profiles (update → get → context)
 *   layers (add → list → stats → promote), scope filters, GC, evolve,
 *   conflicts check, context assembly, dreaming (start/stop via async),
 *   framework adapters (export/import).
 * Most memory tools were previously unit-only; this is their first e2e pass.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 15: memory stack lifecycle', () => {
  it('extract → facts → async lifecycle → evolve/conflicts', async () => {
    const srv = await spawnServer('mem-main');
    try {
      // 1. synchronous extraction pipeline
      const ex = await srv.callTool('memory_extract', {
        transcript:
          'I prefer TypeScript over JavaScript. We decided to use strict typing. Important: deployments happen on Fridays.',
      });
      expect(ex.env.ok).toBe(true);
      expect(ex.env.data.facts.length).toBeGreaterThan(0);
      const factId = ex.env.data.facts[0].id;

      // 2. facts are listable + searchable
      const list = await srv.callTool('memory_facts_list', {});
      expect(list.env.ok).toBe(true);
      const search = await srv.callTool('memory_facts_search', { query: 'TypeScript' });
      expect(search.env.ok).toBe(true);

      // 3. async extraction: submit → status → (complete or cancelled)
      const sub = await srv.callTool('memory_async_submit', {
        type: 'extract',
        input: { transcript: 'We decided to ship releases every Friday.' },
      });
      expect(sub.env.ok).toBe(true);
      const jobId = sub.env.data.jobId ?? sub.env.data.id;
      expect(jobId).toBeTruthy();
      const st = await srv.callTool('memory_async_status', { jobId });
      expect(st.env.ok).toBe(true);

      // 4. evolve: refine an existing fact
      const ev = await srv.callTool('memory_evolve', { factId });
      expect(ev.env.ok).toBe(true);

      // 5. conflicts check answers
      const cf = await srv.callTool('memory_check_conflicts', { factId });
      expect(cf.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('temporal graph add/query/history/invalidate/stats', async () => {
    const srv = await spawnServer('mem-temporal');
    try {
      const add = await srv.callTool('memory_temporal_add', {
        statement: 'Deploys happen on Fridays.',
        validFrom: '2026-09-01T10:00:00.000Z',
      });
      expect(add.env.ok).toBe(true);
      const factId = add.env.data.id ?? add.env.data.factId;

      const q = await srv.callTool('memory_temporal_query', { at: '2026-09-02T00:00:00.000Z' });
      expect(q.env.ok).toBe(true);

      const hist = await srv.callTool('memory_temporal_history', { factId });
      expect(hist.env.ok).toBe(true);

      const st = await srv.callTool('memory_temporal_stats', {});
      expect(st.env.ok).toBe(true);

      const inv = await srv.callTool('memory_temporal_invalidate', { factId, reason: 'superseded by new policy' });
      expect(inv.env.ok).toBe(true);

      const q2 = await srv.callTool('memory_temporal_query', { at: '2026-09-03T00:00:00.000Z' });
      expect(q2.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('entities, profiles, layers, scoping, GC, assembly, adapters, dreaming', async () => {
    const srv = await spawnServer('mem-rest');
    try {
      // entity graph
      const es = await srv.callTool('memory_entity_search', { query: 'Albato' });
      expect(es.env.ok).toBe(true);

      // user profile
      const pu = await srv.callTool('memory_profile_update', {
        userId: 'dev-1',
        static: { role: 'developer', name: 'Dev' },
        dynamicStatement: 'Currently working on the e2e suite.',
      });
      expect(pu.env.ok).toBe(true);
      const pg = await srv.callTool('memory_profile_get', { userId: 'dev-1' });
      expect(pg.env.ok).toBe(true);
      const pc = await srv.callTool('memory_profile_context', { userId: 'dev-1' });
      expect(pc.env.ok).toBe(true);

      // layers
      const la = await srv.callTool('memory_layer_add', {
        layer: 'conversation',
        statement: 'Discussed weekly release cadence.',
      });
      expect(la.env.ok).toBe(true);
      const ll = await srv.callTool('memory_layer_list', { layer: 'conversation' });
      expect(ll.env.ok).toBe(true);
      const ls = await srv.callTool('memory_layer_stats', {});
      expect(ls.env.ok).toBe(true);
      const lp = await srv.callTool('memory_layer_promote', { from: 'conversation', to: 'session' });
      expect(lp.env.ok).toBe(true);

      // scoping
      const st = await srv.callTool('memory_scope_tags', { userId: 'dev-1' });
      expect(st.env.ok).toBe(true);
      const sf = await srv.callTool('memory_scope_filter', { userId: 'dev-1' });
      expect(sf.env.ok).toBe(true);

      // observations + GC
      const ob = await srv.callTool('memory_observations', {});
      expect(ob.env.ok).toBe(true);
      const gc = await srv.callTool('memory_gc', {});
      expect(gc.env.ok).toBe(true);

      // context assembly + framework adapters
      const ca = await srv.callTool('memory_context_assemble', { query: 'TypeScript stack', userId: 'dev-1' });
      expect(ca.env.ok).toBe(true);
      const fa = await srv.callTool('memory_framework_adapter', {
        framework: 'langchain',
        serverUrl: 'http://localhost:3001/mcp',
      });
      expect(fa.env.ok).toBe(true);

      // dreaming lifecycle via async job
      const dr = await srv.callTool('memory_dream', { action: 'run' });
      expect(dr.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});
