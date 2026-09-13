/**
 * tests/reliability-contract.test.ts — TR-08: pin the reliability contract
 * documented in docs/reliability.md.
 *
 * Three areas:
 *  1. Connector fail-fast — injectable fetchFn rejecting (connection refused)
 *     must produce {ok:false, error:{message}} — NOT a hang, NOT a throw.
 *  2. Batch partial-failure — mixed valid+invalid items: overall envelope
 *     stays {ok:true} with successes only in results[]; the dryRun variant of
 *     tasks_bulk_delete_permanent is the only tool with per-item errors.
 *  3. Circuit breaker gating — ServiceAvailability degrades on failures and
 *     withFallback returns the fallback instead of throwing.
 *
 * Connector tests are hermetic (injected fetch). Batch tests run against a
 * real spawned server (dist/index.js) via the e2e harness — the contract is
 * about the wire envelope, so it is pinned end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import { GDriveConnector } from '../src/connectors/gdrive.js';
import { NotionConnector } from '../src/connectors/notion.js';
import { LinearConnector } from '../src/connectors/linear.js';
import { OneDriveConnector } from '../src/connectors/onedrive.js';
import { GmailConnector } from '../src/connectors/gmail.js';
import type { ConnectorContext } from '../src/connectors/types.js';
import { ServiceAvailability, withFallback } from '../src/core/graceful-degradation.js';
import { spawnServer } from './e2e-full/harness.js';

// ─── helpers ────────────────────────────────────────────────────────

type Handler = (input: Record<string, unknown>) => Promise<unknown>;

function mockCtx(config: Record<string, unknown> = {}): { ctx: ConnectorContext; tools: Map<string, Handler> } {
  const tools = new Map<string, Handler>();
  const ctx: ConnectorContext = {
    config,
    registerTool: (name, _schema, handler) => { tools.set(name, handler); },
  };
  return { ctx, tools };
}

/** fetch that always rejects — simulates connection refused / DNS failure. */
const rejectingFetch = vi.fn(async () => {
  throw new Error('connect ECONNREFUSED 10.255.255.1:443');
});

// ─── 1. Connector fail-fast (docs/reliability.md §1) ────────────────

describe('TR-08: connector fail-fast on unreachable remote', () => {
  it('gdrive_list_files returns {ok:false} when fetch rejects', async () => {
    const c = new GDriveConnector(rejectingFetch);
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('gdrive_list_files')!({ folderId: 'root' }) as { ok: boolean; error?: { message: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('ECONNREFUSED');
  });

  it('notion_search_pages returns {ok:false} when fetch rejects', async () => {
    const c = new NotionConnector(rejectingFetch);
    const { ctx, tools } = mockCtx({ apiKey: 'tok' });
    await c.init(ctx);
    const res = await tools.get('notion_search_pages')!({ query: 'x' }) as { ok: boolean; error?: { message: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('ECONNREFUSED');
  });

  it('linear_list_issues returns {ok:false} when fetch rejects', async () => {
    const c = new LinearConnector(rejectingFetch);
    const { ctx, tools } = mockCtx({ apiKey: 'tok' });
    await c.init(ctx);
    const res = await tools.get('linear_list_issues')!({ teamId: 't1' }) as { ok: boolean; error?: { message: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('ECONNREFUSED');
  });

  it('onedrive_list_files returns {ok:false} when fetch rejects', async () => {
    const c = new OneDriveConnector(rejectingFetch);
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('onedrive_list_files')!({ folderPath: '/root' }) as { ok: boolean; error?: { message: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('ECONNREFUSED');
  });

  it('gmail_list_messages returns {ok:false} when fetch rejects', async () => {
    const c = new GmailConnector(rejectingFetch);
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('gmail_list_messages')!({}) as { ok: boolean; error?: { message: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('ECONNREFUSED');
  });

  it('fail-fast is bounded: rejecting fetch resolves in <5s (no hang)', async () => {
    const c = new GDriveConnector(rejectingFetch);
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const start = Date.now();
    await tools.get('gdrive_list_files')!({ folderId: 'root' });
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

// ─── 2. Batch partial-failure (docs/reliability.md §3) ──────────────

describe('TR-08: batch partial-failure envelope contract', () => {
  it('tasks_bulk_update with mixed valid+bogus ids → ok:true, successes only', async () => {
    const srv = await spawnServer('tr08-bulk-tasks');
    try {
      const created = await srv.callTool('tasks_create', { project: 'mcp', title: 'TR08 valid' });
      const validId = created.env.data.id as string;

      const res = await srv.callTool('tasks_bulk_update', {
        project: 'mcp',
        items: [
          { id: validId, title: 'TR08 renamed' },
          { id: 'bogus-id-does-not-exist', title: 'nope' },
        ],
      });
      // Contract: overall envelope ok:true, results contains only successes.
      expect(res.isError).toBe(false);
      expect(res.env.ok).toBe(true);
      expect(res.env.data.count).toBe(1);
      expect(res.env.data.results).toHaveLength(1);
      expect(res.env.data.results[0].id).toBe(validId);
      // Documented gap: no per-item error for the bogus id.
      expect(res.env.data.errors).toBeUndefined();
    } finally {
      await srv.close();
    }
  }, 120000);

  it('knowledge_bulk_update with mixed valid+bogus ids → ok:true, successes only', async () => {
    const srv = await spawnServer('tr08-bulk-kb');
    try {
      const created = await srv.callTool('knowledge_bulk_create', {
        project: 'mcp',
        items: [{ title: 'TR08 doc', content: 'body' }],
      });
      const validId = (created.env.data.created ?? created.env.data)[0].id as string;

      const res = await srv.callTool('knowledge_bulk_update', {
        project: 'mcp',
        items: [
          { id: validId, title: 'TR08 doc renamed' },
          { id: 'bogus-doc-id', title: 'nope' },
        ],
      });
      expect(res.isError).toBe(false);
      expect(res.env.ok).toBe(true);
      expect(res.env.data.count).toBe(1);
      expect(res.env.data.results).toHaveLength(1);
      expect(res.env.data.errors).toBeUndefined();
    } finally {
      await srv.close();
    }
  }, 120000);

  it('tasks_bulk_delete_permanent dryRun → per-item {ok}/{ok:false} entries', async () => {
    const srv = await spawnServer('tr08-bulk-dry');
    try {
      const created = await srv.callTool('tasks_create', { project: 'mcp', title: 'TR08 dry' });
      const validId = created.env.data.id as string;

      const res = await srv.callTool('tasks_bulk_delete_permanent', {
        project: 'mcp',
        ids: [validId, 'bogus-id'],
        dryRun: true,
      });
      expect(res.env.ok).toBe(true);
      expect(res.env.data.dryRun).toBe(true);
      expect(res.env.data.results).toHaveLength(2);
      const [good, bad] = res.env.data.results;
      expect(good.ok).toBe(true);
      expect(bad.ok).toBe(false);
      expect(bad.error.message).toContain('bogus-id');
      // dryRun must not delete
      const still = await srv.callTool('tasks_get', { project: 'mcp', id: validId });
      expect(still.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('tasks_bulk_delete_permanent without confirm → {ok:false} pre-flight refusal', async () => {
    const srv = await spawnServer('tr08-bulk-confirm');
    try {
      const created = await srv.callTool('tasks_create', { project: 'mcp', title: 'TR08 confirm' });
      const res = await srv.callTool('tasks_bulk_delete_permanent', {
        project: 'mcp',
        ids: [created.env.data.id],
      });
      expect(res.isError).toBe(true);
      expect(res.env.ok).toBe(false);
      expect(res.env.error.message).toContain('confirm');
    } finally {
      await srv.close();
    }
  }, 120000);
});

// ─── 3. Circuit breaker / fallback (docs/reliability.md §2) ─────────

describe('TR-08: ServiceAvailability + withFallback contract', () => {
  it('withFallback returns fallback when the call throws', async () => {
    const svc = new ServiceAvailability('test-svc', {
      circuit: { failureThreshold: 2, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 },
    });
    const out = await withFallback(svc, async () => { throw new Error('down'); }, 'fallback-value');
    expect(out).toBe('fallback-value');
    expect(svc.state.totalFailures).toBe(1);
    expect(svc.availability).toBe('available'); // 1 failure < threshold 2
  });

  it('circuit opens after threshold → withFallback short-circuits without calling', async () => {
    const svc = new ServiceAvailability('test-svc-2', {
      circuit: { failureThreshold: 2, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 },
    });
    const spy = vi.fn(async () => { throw new Error('down'); });
    await withFallback(svc, spy, 'fb');
    await withFallback(svc, spy, 'fb');
    expect(svc.availability).toBe('unavailable');
    const callsBefore = spy.mock.calls.length;
    const out = await withFallback(svc, spy, 'fb');
    expect(out).toBe('fb');
    expect(spy.mock.calls.length).toBe(callsBefore); // not called — circuit open
  });

  it('toComponentHealth maps unavailable → unhealthy/ready:false', async () => {
    const svc = new ServiceAvailability('test-svc-3', {
      circuit: { failureThreshold: 1, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 },
    });
    svc.recordFailure();
    const h = svc.toComponentHealth();
    expect(h.status).toBe('unhealthy');
    expect(h.ready).toBe(false);
    expect(h.message).toContain('fallback');
  });
});
