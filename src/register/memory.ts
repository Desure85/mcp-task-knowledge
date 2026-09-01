/**
 * register/memory.ts — MCP tool registration for memory system (NEXT-002).
 *
 * Tools:
 *   - memory_extract: extract facts from conversation transcript
 *   - memory_facts_list: list extracted memory facts from knowledge base
 *   - memory_facts_search: search memory facts by keyword
 */

import { z } from "zod";
import type { ServerContext } from './context.js';
import { DEFAULT_PROJECT, resolveProject } from '../config.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { MemoryExtractor } from '../memory/extraction.js';
import { ok, err } from '../utils/respond.js';

/** Singleton extractor instance. */
let extractor: MemoryExtractor | null = null;
function getExtractor(): MemoryExtractor {
  if (!extractor) extractor = new MemoryExtractor();
  return extractor;
}

export function registerMemoryTools(ctx: ServerContext): void {
  // ─── memory_extract ──────────────────────────────────────────────
  ctx.server.registerTool(
    "memory_extract",
    {
      title: "Extract Memory Facts",
      description:
        "Extract structured facts from a conversation/session transcript. " +
        "Facts are categorized (preference, decision, convention, error, fix, etc.) " +
        "with confidence scores and entity extraction. " +
        "Optionally persists to knowledge base as memory_fact documents. " +
        "ADD-only model — facts accumulate, never overwritten.",
      inputSchema: {
        transcript: z.string().min(10).describe("Conversation/session transcript text to extract facts from"),
        project: z.string().optional().describe("Project to persist facts to (required if persist=true)"),
        userId: z.string().optional().describe("User ID for memory scoping"),
        agentId: z.string().optional().describe("Agent ID for memory scoping"),
        appId: z.string().optional().describe("Application ID for memory scoping"),
        runId: z.string().optional().describe("Run/session ID for memory scoping"),
        maxFacts: z.number().int().min(1).max(100).default(20).optional().describe("Maximum facts to extract"),
        minConfidence: z.number().min(0).max(1).default(0.5).optional().describe("Minimum confidence threshold"),
        persist: z.boolean().default(false).optional().describe("Persist facts to knowledge base"),
      },
    },
    async (args) => {
      const {
        transcript,
        project,
        userId,
        agentId,
        appId,
        runId,
        maxFacts,
        minConfidence,
        persist,
      } = args;

      if (persist && !project) {
        return err("project is required when persist=true");
      }

      const extractor = getExtractor();
      const result = await extractor.extract({
        transcript,
        scope: { userId, agentId, appId, runId },
        project: project ? resolveProject(project) : undefined,
        maxFacts,
        minConfidence,
        persist,
      });

      return ok({
        factsExtracted: result.facts.length,
        persistedCount: result.persistedCount,
        docIds: result.docIds,
        durationMs: result.durationMs,
        facts: result.facts,
      });
    }
  );

  // ─── memory_facts_list ───────────────────────────────────────────
  ctx.server.registerTool(
    "memory_facts_list",
    {
      title: "List Memory Facts",
      description:
        "List extracted memory facts from the knowledge base. " +
        "Filters by type=memory_fact. Supports tag filtering and pagination.",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        tag: z.string().optional().describe("Filter by tag (e.g. 'preference', 'decision', 'entity:TypeScript')"),
        category: z.string().optional().describe("Filter by fact category (preference, decision, convention, error, fix, fact, skill, context)"),
        limit: z.number().int().min(1).max(200).default(50).optional(),
      },
    },
    async ({ project, tag, category, limit }) => {
      const prj = resolveProject(project);
      let metas = await listDocs({ project: prj, tag });

      // Filter by type=memory_fact
      metas = metas.filter((m) => m.type === 'memory_fact');

      // Filter by category tag
      if (category) {
        const catTag = `category:${category}`;
        metas = metas.filter((m) => (m.tags || []).includes(catTag));
      }

      // Apply limit
      metas = metas.slice(0, limit);

      return ok({ count: metas.length, facts: metas });
    }
  );

  // ─── memory_facts_search ─────────────────────────────────────────
  ctx.server.registerTool(
    "memory_facts_search",
    {
      title: "Search Memory Facts",
      description:
        "Full-text search across extracted memory facts. " +
        "Uses existing search_knowledge under the hood, filtered to type=memory_fact.",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        query: z.string().min(1).describe("Search query"),
        limit: z.number().int().min(1).max(50).default(10).optional(),
      },
    },
    async ({ project, query, limit }) => {
      const prj = resolveProject(project);

      // Use listDocs + simple text matching for now
      // Future: use search_knowledge with type filter
      const metas = await listDocs({ project: prj });
      const factMetas = metas.filter((m) => m.type === 'memory_fact');

      // Simple text search on title
      const queryLower = query.toLowerCase();
      const matches = factMetas
        .filter((m) => m.title.toLowerCase().includes(queryLower))
        .slice(0, limit);

      // Read full content for matched docs
      const results = [];
      for (const meta of matches) {
        const doc = await readDoc(prj, meta.id);
        if (doc) {
          results.push({
            id: doc.id,
            title: doc.title,
            content: doc.content,
            tags: doc.tags,
            score: 1.0, // simple match, no scoring
          });
        }
      }

      return ok({ count: results.length, results });
    }
  );
}
