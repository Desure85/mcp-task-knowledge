import { z } from "zod/v3";
import type { ServerContext } from './context.js';
import { loadConfig, resolveProject } from '../config.js';
import { assertTypeAllowed, loadProjectTypes, WorkflowError } from '../workflow.js';
import { storageProfile } from '../core/storage-context.js';
import {
  buildTextForDoc,
  buildTextForTask,
  extractAnchors,
  fuseRankings,
  hybridSearch,
  promoteExactMatches,
  twoStageHybridKnowledgeSearch,
  type VectorSearchAdapter,
} from '../search/index.js';
import { ok, okWith, errWith } from '../utils/respond.js';
import type { KnowledgeDoc, Task } from '../types.js';
import { getServiceAvailabilityRegistry } from '../core/graceful-degradation.js';
import { getWarmupStatus } from '../search/warmup.js';
import { buildEmbeddingsStatus } from '../search/embeddings-status.js';
import type { VectorCollectionInfo } from '../search/contracts.js';
import { TtlLruCache } from '../search/cache.js';
import { PaginationError, clampLimit, encodeOffsetCursor, finalizePage, rankedStart, scopeOf } from '../utils/pagination.js';
import { pageArgsSchema, toPageRequest } from './page-args.js';

/** Ranked id list for one query — ids only, so the cache stays tiny. */
/** Y-02e4: storage and search index come from the context profile, not module imports. */
function taskStore(ctx: ServerContext) {
  return storageProfile(ctx).tasks;
}

function docStore(ctx: ServerContext) {
  return storageProfile(ctx).docs;
}

function searchIndex(ctx: ServerContext) {
  return storageProfile(ctx).search;
}

const RANKED_LIMIT = 200;
const SNIPPET_CHARS = 300;
/** SC-03c: how many FTS rows one query may pull before the in-memory rerank. */
const FTS_CANDIDATE_LIMIT = 500;
// Staleness is bounded by time, not by every write: a corpus fingerprint would be
// invalidated by each sync write and the cache would never hit. 0 disables caching.
const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS ?? 60_000);
const SEARCH_CACHE_MAX = Number(process.env.SEARCH_CACHE_MAX ?? 200);

interface Ranked {
  id: string;
  score: number;
  exactMatches?: number;
  bm25Score?: number;
  vectorScore?: number;
}

interface Candidates {
  ranked: Ranked[];
  source: 'fts' | 'scan';
  /** False when the list is a candidate pool, not the whole match set (AC-02). */
  totalExact: boolean;
}

const rankedCache = new TtlLruCache<string, Candidates>(
  Number.isFinite(SEARCH_CACHE_MAX) ? SEARCH_CACHE_MAX : 200,
  Number.isFinite(SEARCH_CACHE_TTL_MS) ? SEARCH_CACHE_TTL_MS : 15 * 60_000,
);

/** Record vector adapter failures on the process-wide availability tracker. */
function trackVectorError(): (err: unknown) => void {
  return () => getServiceAvailabilityRegistry().get('embeddings').recordFailure();
}

// AC-05: both channel scores are always numbers on the wire. A pure lexical hit (scan without a
// vector adapter) carries its BM25 score in `bm25Score`; a channel that did not run contributes 0.
function toRanked(results: Array<Ranked & { item?: unknown }>): Ranked[] {
  return results.map(({ id, score, exactMatches, bm25Score, vectorScore }) => ({
    id,
    score,
    exactMatches,
    bm25Score: bm25Score ?? score,
    vectorScore: vectorScore ?? 0,
  }));
}

function promoteCandidates<T>(
  query: string,
  items: Array<{ id: string; text: string; item: T }>,
  ranked: Ranked[],
): Ranked[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const base = ranked.flatMap((row) => {
    const item = byId.get(row.id);
    return item ? [{ id: row.id, score: row.score, item: item.item, bm25Score: row.bm25Score }] : [];
  });
  return toRanked(promoteExactMatches(query, items, base, base.length));
}

async function fuseCandidates<T>(
  query: string,
  items: Array<{ id: string; text: string; item: T }>,
  ranked: Ranked[],
  adapter: VectorSearchAdapter<T>,
): Promise<Ranked[]> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const lexical = ranked.flatMap((row) => {
    const item = byId.get(row.id);
    return item ? [{ id: row.id, score: row.score, item: item.item, bm25Score: row.bm25Score }] : [];
  });
  const poolSize = Math.max(items.length, 1);
  try {
    const semantic = await adapter.search(query, items, { limit: poolSize });
    const fused = fuseRankings(lexical, semantic, poolSize);
    return toRanked(promoteExactMatches(query, items, fused, poolSize));
  } catch (err) {
    trackVectorError()(err);
    return ranked;
  }
}

async function hydrateCandidates<T>(
  query: string,
  hits: Array<{ id: string; project: string; score: number }>,
  load: (id: string, project: string) => Promise<T | null>,
  adapter: VectorSearchAdapter<T> | undefined,
  textOf: (item: T) => string,
): Promise<Ranked[]> {
  const anchors = extractAnchors(query);
  const needItems = Boolean(adapter) || anchors.length > 0;
  if (!needItems) return hits.map((hit) => ({ id: hit.id, score: hit.score, bm25Score: hit.score, vectorScore: 0 }));

  const loaded = await Promise.all(hits.map((hit) => load(hit.id, hit.project)));
  const items = hits.flatMap((hit, index) => {
    const item = loaded[index];
    return item ? [{ id: hit.id, text: textOf(item), item }] : [];
  });
  const present = new Set(items.map((item) => item.id));
  const ranked = hits.filter((hit) => present.has(hit.id)).map((hit) => ({ id: hit.id, score: hit.score, bm25Score: hit.score, vectorScore: 0 }));
  if (adapter && items.length > 0) return fuseCandidates(query, items, ranked, adapter);
  if (anchors.length > 0 && items.length > 0) return promoteCandidates(query, items, ranked);
  return ranked;
}

async function ftsTaskCandidates(ctx: ServerContext, prj: string, query: string, adapter: VectorSearchAdapter<Task> | undefined): Promise<Candidates | null> {
  const index = searchIndex(ctx);
  if (!index.isIndexComplete(prj)) return null;
  const hits = index.candidates({
    store: index.taskStoreId(),
    kind: 'task',
    project: prj,
    query,
    limit: FTS_CANDIDATE_LIMIT,
  });
  const exhaustive = hits.length < FTS_CANDIDATE_LIMIT;
  if (hits.length === 0) return adapter ? null : { ranked: [], source: 'fts', totalExact: true };
  const ranked = await hydrateCandidates(query, hits, (id) => taskStore(ctx).get(prj, id), adapter, buildTextForTask);
  return { ranked, source: 'fts', totalExact: exhaustive && ranked.length === hits.length };
}

async function ftsDocCandidates(ctx: ServerContext, prj: string, query: string, adapter: VectorSearchAdapter<KnowledgeDoc> | undefined): Promise<Candidates | null> {
  const index = searchIndex(ctx);
  if (!index.isIndexComplete(prj)) return null;
  const hits = index.candidates({
    store: index.docStoreId(),
    kind: 'doc',
    project: prj,
    query,
    limit: FTS_CANDIDATE_LIMIT,
  });
  const exhaustive = hits.length < FTS_CANDIDATE_LIMIT;
  if (hits.length === 0) return adapter ? null : { ranked: [], source: 'fts', totalExact: true };
  const ranked = await hydrateCandidates(query, hits, (id, project) => docStore(ctx).read(project || prj, id), adapter, buildTextForDoc);
  return { ranked, source: 'fts', totalExact: exhaustive && ranked.length === hits.length };
}

/** AC-05: hint for a client that hit a filling index; not a promise about fill duration. */
const INDEXING_RETRY_MS = 1000;
// AC-05: above this corpus size a file scan can outlive the client's request timeout, so the
// answer is an explicit `INDEXING` instead. Env override exists for tests and operators.
const DEFAULT_SCAN_MAX_TASKS = 2000;

function scanMaxTasks(): number {
  const raw = Number(process.env.SEARCH_SCAN_MAX_TASKS ?? DEFAULT_SCAN_MAX_TASKS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_SCAN_MAX_TASKS;
}

function projectTaskCount(ctx: ServerContext, prj: string): number | undefined {
  return searchIndex(ctx).countTasks(prj);
}

/**
 * AC-05: decide whether the file scan must be replaced by a typed `INDEXING` answer.
 * Only a running fill is retryable; a dirty index needs `reindex`, and without an index the
 * scan is the normal path. A `type`-filtered search stays on files by design (SC-03c).
 */
function scanDeferral(ctx: ServerContext, prj: string, type: string | undefined): { tasks: number } | null {
  if (type) return null;
  const index = searchIndex(ctx);
  if (!index.available() || index.dirty()) return null;
  if (index.fillState(prj) !== 'running') return null;
  const tasks = projectTaskCount(ctx, prj);
  if (tasks === undefined || tasks <= scanMaxTasks()) return null;
  return { tasks };
}

/**
 * AC-05: a scan answer states why the index was not used. A running fill is retryable; a
 * dirty or failed index needs `reindex`; no index at all is the normal file-profile path.
 */
function candidateMeta(candidates: Candidates, ctx: ServerContext, prj: string): Record<string, unknown> {
  const meta: Record<string, unknown> = { source: candidates.source };
  if (candidates.source !== 'scan') return meta;
  const index = searchIndex(ctx);
  if (!index.available()) return meta;
  if (index.dirty()) return { ...meta, indexing: true, needsReindex: true };
  const state = index.fillState(prj);
  if (state === 'running') return { ...meta, indexing: true, retryAfterMs: INDEXING_RETRY_MS };
  if (state === 'error') return { ...meta, indexing: true, needsReindex: true };
  return meta;
}

export function registerSearchTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "search_tasks",
    {
      title: "Search Tasks",
      description: "BM25 (and optional vector) search over tasks",
      inputSchema: {
        project: z.string().optional(),
        query: z.string().min(1),
        ...pageArgsSchema,
        type: z.string().min(1).optional(),
      },
    },
    async ({ project, query, type, ...pageArgs }) => {
      const prj = resolveProject(project);
      try {
        if (type) assertTypeAllowed((await loadProjectTypes(prj)).types, type);
        const request = toPageRequest(pageArgs);
        const scope = scopeOf(prj, query, type);
        const limit = clampLimit(request.limit);
        const pool = Math.max(request.limit ?? 50, 50);
        const adapter = (await ctx.ensureVectorAdapter()) as VectorSearchAdapter<Task> | undefined;
        searchIndex(ctx).ensureIndexed(prj);

        // A type filter is a listing filter applied to the corpus before ranking, so it keeps
        // the file path: post-filtering FTS candidates would change which tasks are ranked.
        let candidates = type ? null : await ftsTaskCandidates(ctx, prj, query, adapter);
        if (!candidates) {
          const defer = scanDeferral(ctx, prj, type);
          if (defer) {
            return errWith({
              code: 'INDEXING',
              message: `The search index for project "${prj}" is still filling (${defer.tasks} tasks); retry in about ${INDEXING_RETRY_MS} ms instead of scanning the files`,
              hint: 'Repeat the same call after retryAfterMs, or run `reindex` to rebuild the index eagerly',
              details: { project: prj, tasks: defer.tasks, retryAfterMs: INDEXING_RETRY_MS },
            });
          }
          const tasks = await taskStore(ctx).list({ project: prj, ...(type ? { type } : {}) });
          const items = tasks.map((t) => ({ id: t.id, text: buildTextForTask(t), item: t }));
          const results = await hybridSearch(query, items, {
            limit: pool,
            vectorAdapter: adapter,
            onVectorError: trackVectorError(),
          });
          candidates = { ranked: toRanked(results), source: 'scan', totalExact: items.length <= pool };
        }

        const ranked = candidates.ranked;
        const start = rankedStart(request, scope, ranked.length);
        const page = ranked.slice(start, start + limit);
        const shape = {
          total: ranked.length,
          totalExact: candidates.totalExact,
          hasMore: start + page.length < ranked.length,
          limit,
        };
        const extra = candidateMeta(candidates, ctx, prj);
        if (request.countOnly) {
          const result = finalizePage([], shape, request, () => null);
          return okWith(result.items, { ...result.meta, ...extra });
        }
        const hydrated = await Promise.all(
          page.map(async (row) => {
            const task = await taskStore(ctx).get(prj, row.id);
            return task ? { ...row, item: task } : null;
          }),
        );
        const result = finalizePage(
          hydrated.filter((row): row is Ranked & { item: Task } => row !== null),
          shape,
          request,
          (index) => encodeOffsetCursor(start + index + 1, scope),
        );
        const meta = candidates.totalExact
          ? { ...result.meta, ...extra }
          : { ...result.meta, ...extra, candidates: ranked.length };
        return okWith(result.items, meta);
      } catch (e) {
        if (e instanceof PaginationError) return errWith({ message: e.message, code: e.code, hint: e.hint });
        if (e instanceof WorkflowError) return errWith(e.toPayload());
        throw e;
      }
    }
  );

  ctx.server.registerTool(
    "search_knowledge",
    {
      title: "Search Knowledge",
      description: "BM25 (and optional vector) search over knowledge docs",
      inputSchema: {
        project: z.string().optional(),
        query: z.string().min(1),
        offset: z.number().int().min(0).max(5000).optional(),
        snippet: z.boolean().optional(),
        ...pageArgsSchema,
      },
    },
    async ({ project, query, offset, snippet, ...pageArgs }: { project?: string; query: string; offset?: number; snippet?: boolean } & Record<string, any>) => {
      const prj = resolveProject(project);
      const cacheKey = `${prj}|${query}`;
      searchIndex(ctx).ensureIndexed(prj);
      let candidates: Candidates | null | undefined = rankedCache.get(cacheKey);
      if (!candidates) {
        const adapter = (await ctx.ensureVectorAdapter()) as VectorSearchAdapter<KnowledgeDoc> | undefined;
        candidates = await ftsDocCandidates(ctx, prj, query, adapter);
        if (!candidates) {
          const metas = await docStore(ctx).list({ project: prj });
          const docs = await Promise.all(metas.map((m) => docStore(ctx).read(m.project || prj, m.id)));
          const valid = docs.filter(Boolean) as NonNullable<typeof docs[number]>[];
          const items = valid.map((d) => ({ id: d.id, text: buildTextForDoc(d), item: d }));
          const results = await hybridSearch(query, items, {
            limit: Math.min(items.length, RANKED_LIMIT),
            vectorAdapter: adapter,
            onVectorError: trackVectorError(),
          });
          candidates = { ranked: toRanked(results), source: 'scan', totalExact: metas.length <= RANKED_LIMIT };
        }
        rankedCache.set(cacheKey, candidates);
      }
      const ranked = candidates.ranked;
      const scope = scopeOf(prj, query);
      const request = toPageRequest({ ...pageArgs, offset });
      const extra = candidateMeta(candidates, ctx, prj);
      // AC-02: a capped ranking is a candidate pool, not the whole match set.
      const withHonesty = (meta: Record<string, unknown>) =>
        candidates!.totalExact ? { ...meta, ...extra } : { ...meta, ...extra, candidates: ranked.length };
      try {
        const limit = clampLimit(request.limit);
        const start = rankedStart(request, scope, ranked.length);
        const page = ranked.slice(start, start + limit);
        if (request.countOnly) {
          const result = finalizePage([], { total: ranked.length, totalExact: candidates.totalExact, hasMore: false, limit }, request, () => null);
          return okWith(result.items, withHonesty(result.meta as unknown as Record<string, unknown>));
        }
        // Read only the requested slice: the rest of the ranking stays as ids.
        const docs = await Promise.all(page.map((r) => docStore(ctx).read(prj, r.id)));
        const byId = new Map<string, NonNullable<typeof docs[number]>>();
        docs.forEach((d) => { if (d) byId.set(d.id, d); });
        const hydrated = page.flatMap((r) => {
          const doc = byId.get(r.id);
          if (!doc) return [];
          const item = snippet === false
            ? doc
            : { ...doc, content: undefined, snippet: String(doc.content ?? '').slice(0, SNIPPET_CHARS) };
          return [{ ...r, item }];
        });
        const result = finalizePage(
          hydrated,
          { total: ranked.length, totalExact: candidates.totalExact, hasMore: start + page.length < ranked.length, limit },
          request,
          (index) => encodeOffsetCursor(start + index + 1, scope),
        );
        return okWith(result.items, withHonesty(result.meta as unknown as Record<string, unknown>));
      } catch (e) {
        if (e instanceof PaginationError) return errWith({ message: e.message, code: e.code, hint: e.hint });
        throw e;
      }
    }
  );

  ctx.server.registerTool(
    "mcp1_search_knowledge_two_stage",
    {
      title: "Search Knowledge (Two-Stage)",
      description: "Two-stage search: Stage1 BM25 over docs (prefilter), Stage2 chunked hybrid within top-M long docs. Controls for prefilterLimit/chunkSize/chunkOverlap.",
      inputSchema: {
        project: z.string().optional(),
        query: z.string().min(1),
        prefilterLimit: z.number().int().min(1).max(200).optional(),
        chunkSize: z.number().int().min(200).max(20000).optional(),
        chunkOverlap: z.number().int().min(0).max(5000).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (
      { project, query, prefilterLimit, chunkSize, chunkOverlap, limit }: {
        project?: string;
        query: string;
        prefilterLimit?: number;
        chunkSize?: number;
        chunkOverlap?: number;
        limit?: number;
      }
    ) => {
      const prj = resolveProject(project);
      const metas = await docStore(ctx).list({ project: prj });
      const docs = await Promise.all(metas.map((m) => docStore(ctx).read(m.project || prj, m.id)));
      const valid = docs.filter(Boolean) as NonNullable<typeof docs[number]>[];
      const va = await ctx.ensureVectorAdapter();
      const results = await twoStageHybridKnowledgeSearch(query, valid, {
        prefilterLimit,
        chunkSize,
        chunkOverlap,
        limit,
        vectorAdapter: va as any,
      });
      return ok(results);
    }
  );

  ctx.server.registerTool(
    "embeddings_status",
    {
      title: "Embeddings Status",
      description: "Show current embeddings configuration and mode",
      inputSchema: {},
    },
    async () => {
      const c = loadConfig();
      const store = storageProfile(ctx).vectors;
      const collections: VectorCollectionInfo[] =
        typeof (store as { collections?: unknown }).collections === 'function'
          ? await (store as unknown as { collections: () => Promise<VectorCollectionInfo[]> }).collections()
          : [];
      const payload = buildEmbeddingsStatus({
        config: c,
        adapterInitAttempted: ctx.vectorInitAttempted,
        adapterReady: Boolean(ctx.vectorAdapter),
        warmup: getWarmupStatus(),
        collections,
        indexing: storageProfile(ctx).indexing?.status(),
      });
      return ok({
        ...payload,
        vectorAdapterEnabled: Boolean(c.embeddings.modelPath && c.embeddings.mode !== "none"),
      });
    }
  );
}
