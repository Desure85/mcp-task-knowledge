import { z } from "zod/v3";
import type { ServerContext } from './context.js';
import { loadConfig, resolveProject } from '../config.js';
import { assertTypeAllowed, loadProjectTypes, WorkflowError } from '../workflow.js';
import { listTasks } from '../storage/tasks.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { buildTextForDoc, buildTextForTask, hybridSearch, twoStageHybridKnowledgeSearch } from '../search/index.js';
import { ok, okWith, errWith } from '../utils/respond.js';
import { getServiceAvailabilityRegistry } from '../core/graceful-degradation.js';
import { getWarmupStatus } from '../search/warmup.js';
import { TtlLruCache } from '../search/cache.js';
import { PaginationError, clampLimit, encodeOffsetCursor, finalizePage, paginateRanked, rankedStart, scopeOf } from '../utils/pagination.js';
import { pageArgsSchema, toPageRequest } from './page-args.js';

/** Ranked id list for one query — ids only, so the cache stays tiny. */
const RANKED_LIMIT = 200;
const SNIPPET_CHARS = 300;
// Staleness is bounded by time, not by every write: a corpus fingerprint would be
// invalidated by each sync write and the cache would never hit. 0 disables caching.
const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS ?? 60_000);
const SEARCH_CACHE_MAX = Number(process.env.SEARCH_CACHE_MAX ?? 200);
const rankedCache = new TtlLruCache<string, Array<{ id: string; score: number; exactMatches?: number; bm25Score?: number; vectorScore?: number }>>(
  Number.isFinite(SEARCH_CACHE_MAX) ? SEARCH_CACHE_MAX : 200,
  Number.isFinite(SEARCH_CACHE_TTL_MS) ? SEARCH_CACHE_TTL_MS : 15 * 60_000,
);

/** Record vector adapter failures on the process-wide availability tracker. */
function trackVectorError(): (err: unknown) => void {
  return () => getServiceAvailabilityRegistry().get('embeddings').recordFailure();
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
        const tasks = await listTasks({ project: prj, ...(type ? { type } : {}) });
        const items = tasks.map((t) => ({ id: t.id, text: buildTextForTask(t), item: t }));
        const pool = Math.max(request.limit ?? 50, 50);
        const results = await hybridSearch(query, items, {
          limit: pool,
          vectorAdapter: await ctx.ensureVectorAdapter(),
          onVectorError: trackVectorError(),
        });
        const paged = paginateRanked(results, request, scopeOf(prj, query, type));
        return okWith(paged.items, paged.meta);
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
      const metas = await listDocs({ project: prj });
      const cacheKey = `${prj}|${query}`;
      let ranked = rankedCache.get(cacheKey);
      if (!ranked) {
        const docs = await Promise.all(metas.map((m) => readDoc(m.project || prj, m.id)));
        const valid = docs.filter(Boolean) as NonNullable<typeof docs[number]>[];
        const items = valid.map((d) => ({ id: d.id, text: buildTextForDoc(d), item: d }));
        const results = await hybridSearch(query, items, {
          limit: Math.min(items.length, RANKED_LIMIT),
          vectorAdapter: await ctx.ensureVectorAdapter(),
          onVectorError: trackVectorError(),
        });
        ranked = results.map(({ id, score, exactMatches, bm25Score, vectorScore }) => ({ id, score, exactMatches, bm25Score, vectorScore }));
        rankedCache.set(cacheKey, ranked);
      }
      const scope = scopeOf(prj, query);
      const request = toPageRequest({ ...pageArgs, offset });
      try {
        const limit = clampLimit(request.limit);
        const start = rankedStart(request, scope, ranked.length);
        const page = ranked.slice(start, start + limit);
        if (request.countOnly) {
          const result = finalizePage([], { total: ranked.length, totalExact: true, hasMore: false, limit }, request, () => null);
          return okWith(result.items, result.meta);
        }
        // Read only the requested slice: the rest of the ranking stays as ids.
        const docs = await Promise.all(page.map((r) => readDoc(prj, r.id)));
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
          { total: ranked.length, totalExact: true, hasMore: start + page.length < ranked.length, limit },
          request,
          (index) => encodeOffsetCursor(start + index + 1, scope),
        );
        return okWith(result.items, result.meta);
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
      const metas = await listDocs({ project: prj });
      const docs = await Promise.all(metas.map((m) => readDoc(m.project || prj, m.id)));
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
      const payload = {
        mode: c.embeddings.mode,
        hasModelPath: Boolean(c.embeddings.modelPath),
        modelPath: c.embeddings.modelPath ?? null,
        dim: c.embeddings.dim ?? null,
        cacheDir: c.embeddings.cacheDir || null,
        vectorAdapterEnabled: Boolean(c.embeddings.modelPath && c.embeddings.mode !== "none"),
        adapterInitAttempted: ctx.vectorInitAttempted,
        adapterReady: Boolean(ctx.vectorAdapter),
        warmup: getWarmupStatus(),
      };
      return ok(payload);
    }
  );
}
