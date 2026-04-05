import { z } from "zod";
import type { ServerContext } from './context.js';
import { loadConfig, resolveProject } from '../config.js';
import { listTasks } from '../storage/tasks.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { buildTextForDoc, buildTextForTask, hybridSearch, twoStageHybridKnowledgeSearch } from '../search/index.js';
import { ok, err } from '../utils/respond.js';

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
      },
    },
    async ({ project, query, limit }) => {
      const prj = resolveProject(project);
      const tasks = await listTasks({ project: prj });
      const items = tasks.map((t) => ({ id: t.id, text: buildTextForTask(t), item: t }));
      const results = await hybridSearch(query, items, { limit: limit ?? 20, vectorAdapter: ctx.vectorAdapter });
      return ok(results);
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
      },
    },
    async ({ project, query, limit }: { project?: string; query: string; limit?: number }) => {
      const prj = resolveProject(project);
      const metas = await listDocs({ project: prj });
      const docs = await Promise.all(metas.map((m) => readDoc(m.project || prj, m.id)));
      const valid = docs.filter(Boolean) as NonNullable<typeof docs[number]>[];
      const items = valid.map((d) => ({ id: d.id, text: buildTextForDoc(d), item: d }));
      const results = await hybridSearch(query, items, { limit: limit ?? 20, vectorAdapter: ctx.vectorAdapter });
      return ok(results);
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
        dim: c.embeddings.dim ?? null,
        cacheDir: c.embeddings.cacheDir || null,
        vectorAdapterEnabled: Boolean(c.embeddings.modelPath && c.embeddings.dim && c.embeddings.mode !== 'none'),
      };
      return ok(payload);
    }
  );
}
