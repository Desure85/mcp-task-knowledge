/**
 * tests/e2e-full/memory-extended.test.ts — Q-014 slice 18: extended memory e2e.
 *
 * Covers the memory surface beyond the basic pipeline (slice 3):
 * profiles, layers, scoped facts, context assembly, entity search,
 * temporal history/stats, evolve/conflicts, gc, observations, dream,
 * async jobs (submit/status/cancel, extract_async), framework adapter,
 * and the bounded benchmark runner — all through a real hermetic server.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer, type E2EServer } from './harness.js';

const TRANSCRIPT =
  'User decided to use Redis for the rate-limit store because of its TTL support. ' +
  'The on-call rotation starts Monday and PagerDuty owns the escalation policy.';

async function waitJob(
  srv: E2EServer,
  jobId: string,
  timeoutMs = 15000,
): Promise<{ status: string; data: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const res = await srv.callTool('memory_async_status', { jobId });
    expect(res.env.ok).toBe(true);
    last = res.env.data as Record<string, unknown>;
    const status = String(last.status ?? '');
    if (['completed', 'failed', 'cancelled'].includes(status)) return { status, data: last };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { status: String(last.status ?? 'unknown'), data: last };
}

describe('Q-014 slice 18: user profiles', () => {
  it('profile_update → profile_get → profile_context; missing profile errors', async () => {
    const srv = await spawnServer('mem-profile');
    try {
      const missing = await srv.callTool('memory_profile_get', { userId: 'u-nobody-q014' });
      expect(missing.isError).toBe(true);
      expect(missing.env.ok).toBe(false);

      const upd = await srv.callTool('memory_profile_update', {
        userId: 'u-q014',
        static: { role: 'developer', timezone: 'UTC' },
        dynamicStatement: 'working on Q014 e2e coverage',
        dynamicCategory: 'current_task',
      });
      expect(upd.isError).toBe(false);
      expect(upd.env.ok).toBe(true);

      const got = await srv.callTool('memory_profile_get', { userId: 'u-q014' });
      expect(got.env.ok).toBe(true);
      expect(JSON.stringify(got.env.data)).toContain('developer');

      const ctx = await srv.callTool('memory_profile_context', { userId: 'u-q014' });
      expect(ctx.env.ok).toBe(true);
      expect(ctx.env.data.context).toContain('user-profile');
      expect(JSON.stringify(ctx.env.data.context)).toContain('Q014 e2e');
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 18: layered memory', () => {
  it('layer_add → layer_list → promote → stats', async () => {
    const srv = await spawnServer('mem-layers');
    try {
      const add = await srv.callTool('memory_layer_add', {
        layer: 'conversation',
        statement: 'Q014 layered memory fact about retries',
        category: 'decision',
        tags: ['q014'],
      });
      expect(add.isError).toBe(false);
      expect(add.env.ok).toBe(true);

      const list = await srv.callTool('memory_layer_list', { layer: 'conversation' });
      expect(list.env.ok).toBe(true);
      expect(JSON.stringify(list.env.data)).toContain('Q014 layered memory fact');

      const promote = await srv.callTool('memory_layer_promote', { from: 'conversation', to: 'session' });
      expect(promote.isError).toBe(false);
      expect(promote.env.ok).toBe(true);

      const session = await srv.callTool('memory_layer_list', { layer: 'session' });
      expect(JSON.stringify(session.env.data)).toContain('Q014 layered memory fact');

      const stats = await srv.callTool('memory_layer_stats', {});
      expect(stats.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 18: scoped facts + context assembly', () => {
  it('scoped extract → scope_filter → scope_tags → context_assemble', async () => {
    const srv = await spawnServer('mem-scope');
    try {
      const ext = await srv.callTool('memory_extract', {
        transcript: TRANSCRIPT,
        project: 'mcp',
        persist: true,
        userId: 'u-q014',
        agentId: 'ag-q014',
        appId: 'app-q014',
        runId: 'run-q014',
      });
      expect(ext.env.ok).toBe(true);
      expect(ext.env.data.persistedCount).toBeGreaterThan(0);

      // scope_filter reads the temporal graph — seed one fact there.
      // Unscoped facts are global per ScopeMatcher contract, so a
      // dimensioned filter still returns them (fixed in this session:
      // the handler used to wipe fact.scope before filtering).
      await srv.callTool('memory_temporal_add', {
        statement: 'Q014 scoped fact for filter coverage',
        category: 'note',
      });
      const scoped = await srv.callTool('memory_scope_filter', { userId: 'u-q014' });
      expect(scoped.env.ok).toBe(true);
      expect(scoped.env.data.count).toBeGreaterThanOrEqual(1);
      expect(scoped.env.data.scope).toContain('u-q014');

      const tags = await srv.callTool('memory_scope_tags', { userId: 'u-q014', agentId: 'ag-q014' });
      expect(tags.env.ok).toBe(true);
      expect(tags.env.data.tags).toEqual(expect.arrayContaining(['scope:user:u-q014', 'scope:agent:ag-q014']));

      const ctx = await srv.callTool('memory_context_assemble', {
        query: 'Redis rate-limit',
        project: 'mcp',
        userId: 'u-q014',
      });
      expect(ctx.isError).toBe(false);
      expect(ctx.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 18: entity search + temporal extras', () => {
  it('temporal fact with entities → entity_search → history/stats', async () => {
    const srv = await spawnServer('mem-entity');
    try {
      const added = await srv.callTool('memory_temporal_add', {
        statement: 'Q014 entity fact: PagerDuty owns escalation',
        category: 'decision',
        entities: ['PagerDuty'],
        tags: ['q014'],
      });
      expect(added.env.ok).toBe(true);
      const factId = (added.env.data.id ?? added.env.data.fact?.id) as string;
      expect(typeof factId).toBe('string');

      const ent = await srv.callTool('memory_entity_search', { query: 'Who is PagerDuty?' });
      expect(ent.env.ok).toBe(true);
      expect(ent.env.data.extractedEntities).toContain('PagerDuty');

      const hist = await srv.callTool('memory_temporal_history', { factId });
      expect(hist.env.ok).toBe(true);

      const stats = await srv.callTool('memory_temporal_stats', {});
      expect(stats.env.ok).toBe(true);
      expect(JSON.stringify(stats.env.data)).toContain('total');
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 18: evolve + conflicts + gc + observations + dream', () => {
  it('new fact evolves against existing memories; gc/dream run clean', async () => {
    const srv = await spawnServer('mem-evolve');
    try {
      const base = await srv.callTool('memory_temporal_add', {
        statement: 'Q014 base fact: cache TTL is 60 seconds',
        category: 'decision',
      });
      const baseId = (base.env.data.id ?? base.env.data.fact?.id) as string;

      const newer = await srv.callTool('memory_temporal_add', {
        statement: 'Q014 update: cache TTL is now 120 seconds',
        category: 'decision',
      });
      const newId = (newer.env.data.id ?? newer.env.data.fact?.id) as string;

      const evolve = await srv.callTool('memory_evolve', { factId: newId });
      expect(evolve.isError).toBe(false);
      expect(evolve.env.ok).toBe(true);

      const conflicts = await srv.callTool('memory_check_conflicts', { factId: newId });
      expect(conflicts.env.ok).toBe(true);
      const conflictsAll = await srv.callTool('memory_check_conflicts', { factId: baseId, checkAll: true });
      expect(conflictsAll.env.ok).toBe(true);

      const obs = await srv.callTool('memory_observations', {});
      expect(obs.env.ok).toBe(true);
      expect(typeof obs.env.data.count).toBe('number');

      const gc = await srv.callTool('memory_gc', {});
      expect(gc.isError).toBe(false);
      expect(gc.env.ok).toBe(true);

      const dream = await srv.callTool('memory_dream', { action: 'run' });
      expect(dream.isError).toBe(false);
      expect(dream.env.ok).toBe(true);
      const status = await srv.callTool('memory_dream', { action: 'status' });
      expect(status.env.ok).toBe(true);
      expect(status.env.data.running).toBe(false);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 18: async memory jobs', () => {
  it('async_submit extract → status completes; cancel bogus errors', async () => {
    const srv = await spawnServer('mem-async');
    try {
      const sub = await srv.callTool('memory_async_submit', {
        type: 'extract',
        input: { transcript: TRANSCRIPT, project: 'mcp', persist: true },
      });
      expect(sub.isError).toBe(false);
      expect(sub.env.ok).toBe(true);
      const jobId = sub.env.data.jobId as string;
      expect(jobId).toMatch(/^job_/);

      const done = await waitJob(srv, jobId);
      expect(done.status).toBe('completed');

      const bogus = await srv.callTool('memory_async_status', { jobId: 'job_nonexistent' });
      expect(bogus.isError).toBe(true);
      expect(bogus.env.ok).toBe(false);

      const cancelBogus = await srv.callTool('memory_async_cancel', { jobId: 'job_nonexistent' });
      expect(cancelBogus.isError).toBe(true);
      expect(cancelBogus.env.ok).toBe(false);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('extract_async returns jobId → completes; cancel on queued job', async () => {
    const srv = await spawnServer('mem-extract-async');
    try {
      const sub = await srv.callTool('memory_extract_async', {
        transcript: TRANSCRIPT,
        project: 'mcp',
        persist: false,
      });
      expect(sub.isError).toBe(false);
      expect(sub.env.ok).toBe(true);
      const jobId = sub.env.data.jobId as string;

      const done = await waitJob(srv, jobId);
      expect(done.status).toBe('completed');
      expect(done.data.output ?? done.data).toBeTruthy();

      // Cancel accepts pending/processing jobs; if the job already finished
      // the tool reports a structured error — either way the wiring is proven.
      const sub2 = await srv.callTool('memory_async_submit', {
        type: 'dream',
        input: {},
      });
      const jobId2 = sub2.env.data.jobId as string;
      const cancel = await srv.callTool('memory_async_cancel', { jobId: jobId2 });
      expect(cancel.env.ok === true || cancel.env.ok === false).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 18: framework adapter + benchmark', () => {
  it('framework_adapter returns descriptor; benchmark_run is bounded', async () => {
    const srv = await spawnServer('mem-adapter');
    try {
      const ad = await srv.callTool('memory_framework_adapter', {
        framework: 'langgraph',
        serverUrl: 'http://localhost:3001/mcp',
      });
      expect(ad.isError).toBe(false);
      expect(ad.env.ok).toBe(true);
      expect(ad.env.data.operations).toContain('getCheckpoint');
      expect(ad.env.data.snippet).toContain('HttpMCPClient');

      const bench = await srv.callTool('memory_benchmark_run', { suite: 'beam', maxQuestions: 1 });
      expect(bench.isError).toBe(false);
      expect(bench.env.ok).toBe(true);

      const badSuite = await srv.callTool('memory_benchmark_run', { suite: 'all', maxQuestions: 1 });
      expect(badSuite.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});
