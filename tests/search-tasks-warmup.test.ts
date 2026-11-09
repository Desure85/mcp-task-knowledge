/**
 * AC-05 — `search_tasks` warmup contract and honest status.
 *
 * SC-03c already made the read path answer from FTS with a background fill and an
 * `indexing` flag. This file pins the two gaps that were left:
 *
 *   1. a hit found only by the vector channel must carry `bm25Score: 0` — not a missing
 *      key (fusion used to leave the field `undefined`, and JSON drops undefined keys);
 *   2. every answer produced by the file scan must say why it came from the scan:
 *      a running fill gives `indexing` + `retryAfterMs`, a dirty or failed index gives
 *      `indexing` + `needsReindex`, and a corpus above `SEARCH_SCAN_MAX_TASKS` is not
 *      scanned at all — it returns `error.code === 'INDEXING'` instead of risking the
 *      transport timeout that AC-05 is about.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../src/types.js';
import type { FtsSearchIndex } from '../src/search/fts-index.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

describe('AC-05: search_tasks reports the index state instead of blocking', () => {
  let tasks: typeof import('../src/storage/tasks.js');
  let indexer: typeof import('../src/search/fts-indexer.js');
  let metadata: typeof import('../src/storage/metadata-index.js');
  let registerSearchTools: typeof import('../src/register/search.js').registerSearchTools;
  let FtsSearchIndexCtor: typeof import('../src/search/fts-index.js').FtsSearchIndex;
  let meta: NonNullable<ReturnType<typeof metadata.createMetadataIndex>>;
  let metaDir: string;
  let fts: FtsSearchIndex;

  const project = () => `ac05-${Math.random().toString(16).slice(2, 10)}`;
  const envelope = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);

  function makeTools(adapter?: unknown) {
    const tools = new Map<string, ToolHandler>();
    registerSearchTools({
      server: {
        registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
          tools.set(name, handler);
        },
      },
      ensureVectorAdapter: async () => adapter,
    } as unknown as Parameters<typeof registerSearchTools>[0]);
    return tools;
  }

  beforeAll(async () => {
    tasks = await import('../src/storage/tasks.js');
    indexer = await import('../src/search/fts-indexer.js');
    metadata = await import('../src/storage/metadata-index.js');
    FtsSearchIndexCtor = (await import('../src/search/fts-index.js')).FtsSearchIndex;
    registerSearchTools = (await import('../src/register/search.js')).registerSearchTools;
    // A private data dir: the shared `.tmp-vitest` metadata DB is opened by other suites in
    // parallel workers, and concurrent writers on one SQLite file fail with SQLITE_BUSY.
    metaDir = mkdtempSync(path.join(tmpdir(), 'ac05-index-'));
    const created = metadata.createMetadataIndex({ dataDir: metaDir });
    if (!created) throw new Error('metadata index is required for the AC-05 read path');
    meta = created;
    metadata.setActiveMetadataIndex(meta);
  });

  afterAll(() => {
    metadata.setActiveMetadataIndex(undefined);
    meta.close();
    rmSync(metaDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fts = FtsSearchIndexCtor.inMemory();
    indexer.setActiveFtsIndex(fts);
  });

  afterEach(() => {
    indexer.setActiveFtsIndex(undefined);
    fts.close();
    delete process.env.SEARCH_SCAN_MAX_TASKS;
  });

  async function waitForIndex(prj: string) {
    await indexer.awaitProjectFtsIndexed(prj);
    await metadata.awaitProjectIndexed(prj);
  }

  const search = async (tools: Map<string, ToolHandler>, args: Record<string, unknown>) =>
    envelope(await tools.get('search_tasks')!(args));

  it('gives a vector-only hit bm25Score 0 instead of dropping the field', async () => {
    const prj = project();
    await tasks.createTask({ project: prj, title: 'Falcon migration checklist' });
    await tasks.createTask({ project: prj, title: 'Falcon rollout plan' });
    await tasks.createTask({ project: prj, title: 'Falcon migration notes' });
    const semanticOnly: Task = await tasks.createTask({ project: prj, title: 'Zebra ledger retention' });

    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);
    expect(indexer.isProjectFtsComplete(prj)).toBe(true);

    // The semantic channel finds a task the query never matches lexically.
    const adapter = {
      search: async () => [{ id: semanticOnly.id, score: 0.9, item: semanticOnly }],
    };
    const result = await search(makeTools(adapter), { project: prj, query: 'falcon migration' });
    expect(result.ok).toBe(true);
    const hit = result.data.find((row: { item: { id: string } }) => row.item.id === semanticOnly.id);
    expect(hit).toBeDefined();
    expect(hit.bm25Score).toBe(0);
    expect(hit.vectorScore).toBeGreaterThan(0);
  });

  it('marks the scan as indexing with a retry hint while the fill runs', async () => {
    const prj = project();
    await tasks.createTask({ project: prj, title: 'Kestrel audit notes' });

    const result = await search(makeTools(), { project: prj, query: 'kestrel audit' });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('scan');
    expect(result.indexing).toBe(true);
    expect(typeof result.retryAfterMs).toBe('number');
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.needsReindex).toBeUndefined();

    await waitForIndex(prj);
    const indexed = await search(makeTools(), { project: prj, query: 'kestrel audit' });
    expect(indexed.source).toBe('fts');
    expect(indexed.indexing).toBeUndefined();
    expect(indexed.retryAfterMs).toBeUndefined();
  });

  it('marks a dirty index as needing reindex, not as a retryable fill', async () => {
    const prj = project();
    await tasks.createTask({ project: prj, title: 'Merlin retention policy' });
    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);
    expect(indexer.isProjectFtsComplete(prj)).toBe(true);

    fts.markDirty('simulated write failure');
    const result = await search(makeTools(), { project: prj, query: 'merlin retention' });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('scan');
    expect(result.indexing).toBe(true);
    expect(result.needsReindex).toBe(true);
    expect(result.retryAfterMs).toBeUndefined();
  });

  it('returns INDEXING instead of scanning a corpus above SEARCH_SCAN_MAX_TASKS', async () => {
    process.env.SEARCH_SCAN_MAX_TASKS = '1';
    const prj = project();
    await tasks.createTask({ project: prj, title: 'Osprey rollout checklist' });
    await tasks.createTask({ project: prj, title: 'Osprey rollout runbook' });

    const blocked = await search(makeTools(), { project: prj, query: 'osprey rollout' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error.code).toBe('INDEXING');
    expect(blocked.error.details.retryAfterMs).toBeGreaterThan(0);

    await waitForIndex(prj);
    const served = await search(makeTools(), { project: prj, query: 'osprey rollout' });
    expect(served.ok).toBe(true);
    expect(served.source).toBe('fts');
  });

  it('carries both channel scores on a scan without a vector adapter', async () => {
    indexer.setActiveFtsIndex(undefined);
    const prj = project();
    const first = await tasks.createTask({ project: prj, title: 'Falcon migration checklist' });
    await tasks.createTask({ project: prj, title: 'Falcon rollout notes' });

    const result = await search(makeTools(), { project: prj, query: 'falcon migration' });
    expect(result.source).toBe('scan');
    expect(result.data.length).toBeGreaterThan(0);
    for (const row of result.data) {
      expect(typeof row.bm25Score).toBe('number');
      expect(row.bm25Score).toBeGreaterThan(0);
      expect(row.vectorScore).toBe(0);
    }
    expect(result.data[0].item.id).toBe(first.id);
  });

  it('keeps scanning without markers when no index exists at all', async () => {
    indexer.setActiveFtsIndex(undefined);
    const prj = project();
    await tasks.createTask({ project: prj, title: 'Petrel migration checklist' });

    const result = await search(makeTools(), { project: prj, query: 'petrel migration' });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('scan');
    expect(result.indexing).toBeUndefined();
    expect(result.needsReindex).toBeUndefined();
    expect(result.retryAfterMs).toBeUndefined();
  });

  it('does not add scan markers to a complete index answer', async () => {
    const prj = project();
    await tasks.createTask({ project: prj, title: 'Heron release checklist' });
    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);

    const result = await search(makeTools(), { project: prj, query: 'heron release' });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('fts');
    expect(result.indexing).toBeUndefined();
    expect(result.needsReindex).toBeUndefined();
    expect(result.retryAfterMs).toBeUndefined();
  });
});
