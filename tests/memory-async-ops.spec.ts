/**
 * async-ops.spec.ts — Tests for async memory operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AsyncJobManager,
  getAsyncJobManager,
  resetAsyncJobManager,
  type AsyncProcessor,
  type JobType,
} from '../src/memory/async-ops.js';

describe('AsyncJobManager', () => {
  let mgr: AsyncJobManager;

  beforeEach(() => {
    resetAsyncJobManager();
    mgr = new AsyncJobManager({ maxConcurrent: 2, jobTimeoutMs: 5000 });
  });

  afterEach(() => {
    resetAsyncJobManager();
  });

  it('submits a job and returns immediately with pending status', () => {
    mgr.registerProcessor({
      type: 'extract',
      process: async () => { await new Promise((r) => setTimeout(r, 500)); return { ok: true }; },
    });
    const job = mgr.submit({ type: 'extract', input: { text: 'hello' } });
    expect(job.id).toBeTruthy();
    expect(job.status).toMatch(/pending|processing/);
    expect(job.type).toBe('extract');
    expect(job.createdAt).toBeTruthy();
  });

  it('registers a processor and processes a job', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async (input) => ({ result: `processed: ${(input as { text: string }).text}` }),
    };
    mgr.registerProcessor(processor);

    const job = mgr.submit({ type: 'extract', input: { text: 'test data' } });

    // Wait for completion
    await vi.waitFor(() => {
      expect(mgr.getStatus(job.id)?.status).toBe('completed');
    }, { timeout: 2000 });

    const completed = mgr.getStatus(job.id)!;
    expect(completed.status).toBe('completed');
    expect(completed.output).toEqual({ result: 'processed: test data' });
    expect(completed.completedAt).toBeTruthy();
  });

  it('fails when no processor is registered', async () => {
    const job = mgr.submit({ type: 'search', input: { query: 'test' } });

    await vi.waitFor(() => {
      expect(mgr.getStatus(job.id)?.status).toBe('failed');
    }, { timeout: 2000 });

    const failed = mgr.getStatus(job.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('No processor registered');
  });

  it('cancels a pending job', () => {
    mgr.registerProcessor({
      type: 'extract',
      process: async () => { await new Promise((r) => setTimeout(r, 500)); return { ok: true }; },
    });
    const job = mgr.submit({ type: 'extract', input: { text: 'cancel me' } });
    const cancelled = mgr.cancel(job.id);
    expect(cancelled).toBe(true);
    expect(mgr.getStatus(job.id)?.status).toBe('cancelled');
  });

  it('cannot cancel a completed job', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async () => ({ done: true }),
    };
    mgr.registerProcessor(processor);

    const job = mgr.submit({ type: 'extract', input: {} });
    await vi.waitFor(() => {
      expect(mgr.getStatus(job.id)?.status).toBe('completed');
    }, { timeout: 2000 });

    const result = mgr.cancel(job.id);
    expect(result).toBe(false);
  });

  it('lists jobs with filter', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async () => ({ ok: true }),
    };
    mgr.registerProcessor(processor);

    mgr.submit({ type: 'extract', input: { n: 1 } });
    mgr.submit({ type: 'extract', input: { n: 2 } });
    mgr.submit({ type: 'search', input: { q: 'test' } });

    await vi.waitFor(() => {
      const completed = mgr.list({ status: 'completed' });
      expect(completed.length).toBe(2);
    }, { timeout: 3000 });

    const allExtract = mgr.list({ type: 'extract' });
    expect(allExtract.length).toBe(2);

    const allSearch = mgr.list({ type: 'search' });
    expect(allSearch.length).toBe(1);
  });

  it('emits events for job lifecycle', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async () => ({ result: 'ok' }),
    };
    mgr.registerProcessor(processor);

    const events: string[] = [];
    mgr.on('job:submitted', () => events.push('submitted'));
    mgr.on('job:started', () => events.push('started'));
    mgr.on('job:completed', () => events.push('completed'));

    mgr.submit({ type: 'extract', input: {} });

    await vi.waitFor(() => {
      expect(events).toContain('completed');
    }, { timeout: 2000 });

    expect(events).toContain('submitted');
    expect(events).toContain('started');
  });

  it('tracks progress via callback', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async (_input, _job, onProgress) => {
        onProgress?.(0.5);
        await new Promise((r) => setTimeout(r, 10));
        onProgress?.(1.0);
        return { done: true };
      },
    };
    mgr.registerProcessor(processor);

    const job = mgr.submit({ type: 'extract', input: {} });

    await vi.waitFor(() => {
      expect(mgr.getStatus(job.id)?.status).toBe('completed');
    }, { timeout: 2000 });

    const completed = mgr.getStatus(job.id)!;
    expect(completed.progress).toBe(1);
  });

  it('handles processor errors gracefully', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async () => {
        throw new Error('processing failed');
      },
    };
    mgr.registerProcessor(processor);

    const job = mgr.submit({ type: 'extract', input: {} });

    await vi.waitFor(() => {
      expect(mgr.getStatus(job.id)?.status).toBe('failed');
    }, { timeout: 2000 });

    const failed = mgr.getStatus(job.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('processing failed');
  });

  it('respects maxConcurrent limit', async () => {
    let activeCount = 0;
    let maxActive = 0;
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async () => {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        await new Promise((r) => setTimeout(r, 50));
        activeCount--;
        return { ok: true };
      },
    };
    mgr.registerProcessor(processor);

    for (let i = 0; i < 5; i++) {
      mgr.submit({ type: 'extract', input: { i } });
    }

    await vi.waitFor(() => {
      expect(mgr.list({ status: 'completed' }).length).toBe(5);
    }, { timeout: 5000 });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('returns stats', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async () => ({ ok: true }),
    };
    mgr.registerProcessor(processor);

    mgr.submit({ type: 'extract', input: { n: 1 } });
    mgr.submit({ type: 'extract', input: { n: 2 } });

    await vi.waitFor(() => {
      expect(mgr.stats().completed).toBe(2);
    }, { timeout: 3000 });

    const stats = mgr.stats();
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(2);
    expect(stats.pending).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('cleanup removes old completed jobs', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async () => ({ ok: true }),
    };
    mgr.registerProcessor(processor);

    const job = mgr.submit({ type: 'extract', input: {} });
    await vi.waitFor(() => {
      expect(mgr.getStatus(job.id)?.status).toBe('completed');
    }, { timeout: 2000 });

    // Manually backdate the completedAt
    const j = mgr.getStatus(job.id)!;
    j.completedAt = new Date(Date.now() - 3_700_000).toISOString(); // > 1hr retention

    const removed = mgr.cleanup();
    expect(removed).toBe(1);
    expect(mgr.getStatus(job.id)).toBeNull();
  });

  it('skips webhook when no URL provided', async () => {
    const processor: AsyncProcessor = {
      type: 'extract',
      process: async () => ({ ok: true }),
    };
    mgr.registerProcessor(processor);

    const job = mgr.submit({ type: 'extract', input: {} });
    await vi.waitFor(() => {
      expect(mgr.getStatus(job.id)?.status).toBe('completed');
    }, { timeout: 2000 });

    const completed = mgr.getStatus(job.id)!;
    expect(completed.webhookStatus).toBe('skipped');
  });
});

describe('getAsyncJobManager', () => {
  afterEach(() => {
    resetAsyncJobManager();
  });

  it('returns a singleton instance', () => {
    const a = getAsyncJobManager();
    const b = getAsyncJobManager();
    expect(a).toBe(b);
  });

  it('reset creates a new instance', () => {
    const a = getAsyncJobManager();
    resetAsyncJobManager();
    const b = getAsyncJobManager();
    expect(a).not.toBe(b);
  });
});
