import { z } from "zod";
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
        limit: z.number().int().min(1).max(100).optional(),
        type: z.string().min(1).optional(),
      },
    },
    async ({ project, query, limit, type }) => {
      const prj = resolveProject(project);
      try {
        if (type) assertTypeAllowed((await loadProjectTypes(prj)).types, type);
        const tasks = await listTasks({ project: prj, type });
        const items = tasks.map((t) => ({ id: t.id, text: buildTextForTask(t), item: t }));
        const results = await hybridSearch(query, items, { limit: limit ?? 20, vectorAdapter: await ctx.ensureVectorAdapter(), onVectorError: trackVectorError() });
        return ok(results);
      } catch (e) {
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
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(5000).optional(),
        snippet: z.boolean().optional(),
      },
    },
    async ({ project, query, limit, offset, snippet }: { project?: string; query: string; limit?: number; offset?: number; snippet?: boolean }) => {
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
      const start = offset ?? 0;
      const page = ranked.slice(start, start + (limit ?? 20));
      // Read only the requested slice: the rest of the ranking stays as ids.
      const docs = await Promise.all(page.map((r) => readDoc(prj, r.id)));
      const byId = new Map<string, NonNullable<typeof docs[number]>>();
      docs.forEach((d) => { if (d) byId.set(d.id, d); });
      const data = page.flatMap((r) => {
        const doc = byId.get(r.id);
        if (!doc) return [];
        const item = snippet === false
          ? doc
          : { ...doc, content: undefined, snippet: String(doc.content ?? '').slice(0, SNIPPET_CHARS) };
        return [{ ...r, item }];
      });
      return okWith(data, {
        total: ranked.length,
        offset: start,
        hasMore: start + page.length < ranked.length,
        nextOffset: start + page.length,
      });
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
