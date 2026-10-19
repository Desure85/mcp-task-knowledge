import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startWarmup,
  scheduleProjectIndex,
  getWarmupStatus,
  resetWarmupForTests,
} from '../src/search/warmup.js';
import { emitKnowledgeChanged, resetKnowledgeListeners } from '../src/storage/knowledge-events.js';

const ENV_SNAPSHOT = { ...process.env } as Record<string, string | undefined>;

interface WarmupCall {
  items: Array<{ id: string; text: string }>;
  opts?: { budgetMs?: number };
}

function makeHost(docs: Array<{ id: string }> = [{ id: 'a' }, { id: 'b' }]) {
  const calls: WarmupCall[] = [];
  const searches: string[] = [];
  const adapter = {
    async search() {
      return [];
    },
    async warmup(items: WarmupCall['items'], opts?: WarmupCall['opts']) {
      calls.push({ items, opts });
      return { total: items.length, encoded: items.length, cached: 0, elapsedMs: 1, budgetExceeded: false };
    },
  };
  const host = {
    ensureVectorAdapter: async () => adapter,
  };
  const deps = {
    listDocs: async (filter?: { project?: string }) => {
      searches.push(filter?.project ?? '');
      return docs;
    },
    readDoc: async (_project: string, id: string) => ({ id, title: `title ${id}`, content: `body ${id}`, tags: [] }),
    buildText: (doc: { id: string; title: string; content: string }) => `${doc.title}\n${doc.content}`,
    now: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  };
  return { host, deps, calls, searches };
}

async function waitDone(): Promise<void> {
  await vi.waitFor(() => {
    expect(getWarmupStatus().some((s) => s.state === 'done')).toBe(true);
  }, { timeout: 2000, interval: 5 });
}

describe('background knowledge warmup', () => {
  beforeEach(() => {
    process.env = { ...ENV_SNAPSHOT } as Record<string, string | undefined>;
    // loadConfig() downgrades onnx modes to `none` when model path/dim are missing;
    // warmup tests need a "configured" embeddings mode without loading a model.
    process.env.EMBEDDINGS_MODE = 'onnx-cpu';
    process.env.EMBEDDINGS_MODEL_PATH = '/tmp/fake-model.onnx';
    process.env.EMBEDDINGS_DIM = '768';
    delete process.env.EMBEDDINGS_WARMUP;
    resetWarmupForTests();
    resetKnowledgeListeners();
  });

  afterEach(() => {
    resetWarmupForTests();
    resetKnowledgeListeners();
    process.env = { ...ENV_SNAPSHOT } as Record<string, string | undefined>;
  });

  it('indexes every doc of the requested project and reports done', async () => {
    const { host, deps, calls } = makeHost();
    await startWarmup(host, { projects: ['p1'], deps, delayMs: 0 });
    await waitDone();

    expect(calls).toHaveLength(1);
    expect(calls[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(calls[0].items[0].text).toBe('title a\nbody a');

    const status = getWarmupStatus().find((s) => s.project === 'p1');
    expect(status).toMatchObject({ state: 'done', indexed: 2, total: 2, budgetMs: 180_000 });
  });

  it('passes the configured budget to the adapter', async () => {
    const { host, deps, calls } = makeHost();
    await startWarmup(host, { projects: ['p1'], deps, budgetMs: 1234, delayMs: 0 });
    await waitDone();
    expect(calls[0].opts?.budgetMs).toBe(1234);
  });

  it('debounces repeated schedules into a single indexing run', async () => {
    const { host, deps, calls } = makeHost();
    await startWarmup(host, { projects: ['p1'], deps, delayMs: 0 });
    await waitDone();

    scheduleProjectIndex('p1', { delayMs: 20 });
    scheduleProjectIndex('p1', { delayMs: 20 });
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 2000, interval: 5 });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(2);
  });

  it('re-indexes when a knowledge doc is written', async () => {
    const { host, deps, calls, searches } = makeHost();
    await startWarmup(host, { projects: ['p1'], deps, delayMs: 0 });
    await waitDone();

    emitKnowledgeChanged('p2', 'created', 'new-doc');
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 2000, interval: 5 });
    expect(searches).toContain('p2');
  });

  it('stays disabled when embeddings are off', async () => {
    process.env.EMBEDDINGS_MODE = 'none';
    const { host, deps, calls } = makeHost();
    await startWarmup(host, { projects: ['p1'], deps, delayMs: 0 });

    expect(calls).toHaveLength(0);
    expect(getWarmupStatus()).toEqual([
      expect.objectContaining({ project: 'p1', state: 'disabled', reason: 'EMBEDDINGS_MODE=none' }),
    ]);
  });

  it('stays disabled when EMBEDDINGS_WARMUP=0', async () => {
    process.env.EMBEDDINGS_WARMUP = '0';
    const { host, deps, calls } = makeHost();
    await startWarmup(host, { projects: ['p1'], deps, delayMs: 0 });

    expect(calls).toHaveLength(0);
    expect(getWarmupStatus()[0]).toMatchObject({ state: 'disabled', reason: 'EMBEDDINGS_WARMUP=0' });
  });

  it('records an error status when the adapter fails', async () => {
    const host = {
      ensureVectorAdapter: async () => {
        throw new Error('model exploded');
      },
    };
    await startWarmup(host, { projects: ['p1'], deps: makeHost().deps, delayMs: 0 });
    await vi.waitFor(() => {
      expect(getWarmupStatus()[0]?.state).toBe('error');
    }, { timeout: 2000, interval: 5 });
    expect(getWarmupStatus()[0].error).toContain('model exploded');
  });
});
