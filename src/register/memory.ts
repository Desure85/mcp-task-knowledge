/**
 * register/memory.ts — MCP tool registration for memory system.
 *
 * Tools:
 *   - memory_extract: extract facts from conversation transcript (NEXT-002)
 *   - memory_facts_list: list extracted memory facts from knowledge base
 *   - memory_facts_search: search memory facts by keyword
 *   - memory_temporal_add: add a fact to temporal graph (NEXT-001)
 *   - memory_temporal_query: query facts at a point in time (NEXT-001)
 *   - memory_temporal_invalidate: invalidate a fact (NEXT-001)
 *   - memory_temporal_history: get fact history chain (NEXT-001)
 *   - memory_temporal_stats: graph statistics (NEXT-001)
 *   - memory_profile_get: get user profile (NEXT-004)
 *   - memory_profile_update: update user profile (NEXT-004)
 *   - memory_profile_context: build always-on context block (NEXT-004)
 */

import { z } from "zod";
import type { ServerContext } from './context.js';
import { DEFAULT_PROJECT, resolveProject } from '../config.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { MemoryExtractor } from '../memory/extraction.js';
import { TemporalGraph } from '../memory/temporal-graph.js';
import { ProfileManager } from '../memory/user-profile.js';
import { ContextAssembler, type SearchFn } from '../memory/context-assembly.js';
import { EntityRetriever } from '../memory/entity-retrieval.js';
import { MemoryEvolver } from '../memory/evolution.js';
import { ConflictResolver } from '../memory/conflict-resolver.js';
import { ForgettingManager } from '../memory/forgetting.js';
import { ScopeMatcher, buildScopeTags } from '../memory/scoping.js';
import { ok, err } from '../utils/respond.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Singleton extractor instance. */
let extractor: MemoryExtractor | null = null;
function getExtractor(): MemoryExtractor {
  if (!extractor) extractor = new MemoryExtractor();
  return extractor;
}

/** Singleton temporal graph instance. */
let temporalGraph: TemporalGraph | null = null;
function getTemporalGraph(): TemporalGraph {
  if (!temporalGraph) {
    const storagePath = join(homedir(), '.local', 'share', 'mcp-task-knowledge', 'temporal-graph.json');
    temporalGraph = new TemporalGraph({ storagePath });
  }
  return temporalGraph;
}

/** Singleton profile manager instance. */
let profileMgr: ProfileManager | null = null;
function getProfileManager(): ProfileManager {
  if (!profileMgr) {
    const storagePath = join(homedir(), '.local', 'share', 'mcp-task-knowledge', 'profiles');
    profileMgr = new ProfileManager({ storagePath });
  }
  return profileMgr;
}

let contextAssembler: ContextAssembler | null = null;
function getContextAssembler(): ContextAssembler {
  if (!contextAssembler) {
    const searchFn: SearchFn = async (query, project, limit) => {
      const metas = await listDocs({ project });
      const queryLower = query.toLowerCase();
      const matches = metas
        .filter((m) => m.title.toLowerCase().includes(queryLower))
        .slice(0, limit);
      const results = [];
      for (const meta of matches) {
        const doc = await readDoc(project, meta.id);
        if (doc) {
          results.push({
            id: doc.id,
            title: doc.title,
            content: doc.content.substring(0, 500),
            score: 1.0,
            tags: doc.tags,
          });
        }
      }
      return results;
    };
    contextAssembler = new ContextAssembler({
      searchFn,
      temporalGraph: getTemporalGraph(),
      profileMgr: getProfileManager(),
    });
  }
  return contextAssembler;
}

let entityRetriever: EntityRetriever | null = null;
function getEntityRetriever(): EntityRetriever {
  if (!entityRetriever) {
    entityRetriever = new EntityRetriever({
      temporalGraph: getTemporalGraph(),
    });
  }
  return entityRetriever;
}

let memoryEvolver: MemoryEvolver | null = null;
function getMemoryEvolver(): MemoryEvolver {
  if (!memoryEvolver) {
    memoryEvolver = new MemoryEvolver({ temporalGraph: getTemporalGraph() });
  }
  return memoryEvolver;
}

let conflictResolver: ConflictResolver | null = null;
function getConflictResolver(): ConflictResolver {
  if (!conflictResolver) {
    conflictResolver = new ConflictResolver({ temporalGraph: getTemporalGraph() });
  }
  return conflictResolver;
}

let forgettingMgr: ForgettingManager | null = null;
function getForgettingManager(): ForgettingManager {
  if (!forgettingMgr) {
    forgettingMgr = new ForgettingManager({ temporalGraph: getTemporalGraph() });
  }
  return forgettingMgr;
}

export function registerMemoryTools(ctx: ServerContext): void {
  // ─── memory_extract (NEXT-002) ───────────────────────────────────
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
      const { transcript, project, userId, agentId, appId, runId, maxFacts, minConfidence, persist } = args;

      if (persist && !project) {
        return err("project is required when persist=true");
      }

      const ext = getExtractor();
      const result = await ext.extract({
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
        tag: z.string().optional().describe("Filter by tag"),
        category: z.string().optional().describe("Filter by fact category"),
        limit: z.number().int().min(1).max(200).default(50).optional(),
      },
    },
    async ({ project, tag, category, limit }) => {
      const prj = resolveProject(project);
      let metas = await listDocs({ project: prj, tag });
      metas = metas.filter((m) => m.type === 'memory_fact');
      if (category) {
        const catTag = `category:${category}`;
        metas = metas.filter((m) => (m.tags || []).includes(catTag));
      }
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
      const metas = await listDocs({ project: prj });
      const factMetas = metas.filter((m) => m.type === 'memory_fact');
      const queryLower = query.toLowerCase();
      const matches = factMetas
        .filter((m) => m.title.toLowerCase().includes(queryLower))
        .slice(0, limit);

      const results = [];
      for (const meta of matches) {
        const doc = await readDoc(prj, meta.id);
        if (doc) {
          results.push({ id: doc.id, title: doc.title, content: doc.content, tags: doc.tags, score: 1.0 });
        }
      }
      return ok({ count: results.length, results });
    }
  );

  // ─── memory_temporal_add (NEXT-001) ──────────────────────────────
  ctx.server.registerTool(
    "memory_temporal_add",
    {
      title: "Add Temporal Fact",
      description:
        "Add a fact to the temporal knowledge graph with bi-temporal tracking. " +
        "Optionally supersedes an existing fact (marks old as invalid, links new→old). " +
        "Point-in-time queries available via memory_temporal_query.",
      inputSchema: {
        statement: z.string().min(5).describe("Fact statement"),
        category: z.string().optional().describe("Fact category (preference, decision, convention, etc.)"),
        confidence: z.number().min(0).max(1).default(0.5).optional(),
        tags: z.array(z.string()).optional(),
        entities: z.array(z.string()).optional().describe("Entities mentioned in the fact"),
        validFrom: z.string().optional().describe("When the fact became true (ISO 8601, default: now)"),
        supersedesFactId: z.string().optional().describe("ID of fact this one supersedes"),
        invalidationReason: z.string().optional().describe("Why the old fact is being superseded"),
      },
    },
    async (args) => {
      const graph = getTemporalGraph();
      const fact = graph.addFact({
        statement: args.statement,
        category: args.category,
        confidence: args.confidence,
        tags: args.tags,
        entities: args.entities,
        validFrom: args.validFrom,
        supersedesFactId: args.supersedesFactId,
        invalidationReason: args.invalidationReason,
      });
      return ok(fact);
    }
  );

  // ─── memory_temporal_query (NEXT-001) ────────────────────────────
  ctx.server.registerTool(
    "memory_temporal_query",
    {
      title: "Query Temporal Facts",
      description:
        "Query the temporal knowledge graph. Supports point-in-time queries " +
        "('what was true on 2026-06-01?'), entity/category/tag filters, " +
        "and including/excluding invalidated facts.",
      inputSchema: {
        atTime: z.string().optional().describe("Point in time (ISO 8601) — returns facts valid at this moment"),
        entity: z.string().optional().describe("Filter by entity"),
        category: z.string().optional().describe("Filter by category"),
        tag: z.string().optional().describe("Filter by tag"),
        includeInvalidated: z.boolean().default(false).optional().describe("Include invalidated facts"),
        limit: z.number().int().min(1).max(200).default(50).optional(),
      },
    },
    async (args) => {
      const graph = getTemporalGraph();
      const facts = graph.query({
        atTime: args.atTime,
        entity: args.entity,
        category: args.category,
        tag: args.tag,
        includeInvalidated: args.includeInvalidated,
        limit: args.limit,
      });
      return ok({ count: facts.length, facts });
    }
  );

  // ─── memory_temporal_invalidate (NEXT-001) ───────────────────────
  ctx.server.registerTool(
    "memory_temporal_invalidate",
    {
      title: "Invalidate Temporal Fact",
      description:
        "Mark a fact as no longer valid (without deleting it). " +
        "Sets validTo to now and records the invalidation reason. " +
        "History is preserved — the fact can still be queried via point-in-time queries.",
      inputSchema: {
        factId: z.string().min(1).describe("ID of the fact to invalidate"),
        reason: z.string().min(1).describe("Why the fact is being invalidated"),
      },
    },
    async ({ factId, reason }) => {
      const graph = getTemporalGraph();
      const success = graph.invalidateFact(factId, reason);
      if (!success) {
        return err(`Fact not found: ${factId}`);
      }
      return ok({ factId, invalidated: true, reason });
    }
  );

  // ─── memory_temporal_history (NEXT-001) ──────────────────────────
  ctx.server.registerTool(
    "memory_temporal_history",
    {
      title: "Fact History Chain",
      description:
        "Get the full history chain of a fact — all facts that superseded it " +
        "and all facts it superseded. Useful for understanding how knowledge evolved.",
      inputSchema: {
        factId: z.string().min(1).describe("ID of the fact"),
      },
    },
    async ({ factId }) => {
      const graph = getTemporalGraph();
      const history = graph.getFactHistory(factId);
      return ok({ count: history.length, history });
    }
  );

  // ─── memory_temporal_stats (NEXT-001) ────────────────────────────
  ctx.server.registerTool(
    "memory_temporal_stats",
    {
      title: "Temporal Graph Stats",
      description: "Get statistics about the temporal knowledge graph — total facts, valid/invalidated counts, categories.",
      inputSchema: {},
    },
    async () => {
      const graph = getTemporalGraph();
      return ok(graph.stats());
    }
  );

  // ─── memory_profile_get (NEXT-004) ───────────────────────────────
  ctx.server.registerTool(
    "memory_profile_get",
    {
      title: "Get User Profile",
      description:
        "Get a user's profile — static facts (role, name, preferences) + dynamic facts (current task, recent decisions). " +
        "Always-on context for agent personalization.",
      inputSchema: {
        userId: z.string().min(1).describe("User ID"),
      },
    },
    async ({ userId }) => {
      const mgr = getProfileManager();
      const profile = mgr.getProfile(userId);
      if (!profile) {
        return err(`Profile not found: ${userId}`);
      }
      return ok(profile);
    }
  );

  // ─── memory_profile_update (NEXT-004) ────────────────────────────
  ctx.server.registerTool(
    "memory_profile_update",
    {
      title: "Update User Profile",
      description:
        "Create or update a user profile. Set static facts (role, name, timezone) " +
        "and/or add dynamic facts (current task, recent decision). " +
        "Dynamic facts auto-invalidate previous facts of same category.",
      inputSchema: {
        userId: z.string().min(1).describe("User ID"),
        static: z.record(z.string()).optional().describe("Static facts to set (key→value, e.g. {role: 'developer'})"),
        dynamicStatement: z.string().optional().describe("Dynamic fact statement to add"),
        dynamicCategory: z.string().optional().describe("Category for dynamic fact (e.g. 'current_task', 'recent_decision')"),
      },
    },
    async (args) => {
      const mgr = getProfileManager();
      const profile = mgr.updateProfile(args.userId, {
        static: args.static,
        dynamicFact: args.dynamicStatement
          ? { statement: args.dynamicStatement, category: args.dynamicCategory }
          : undefined,
      });
      return ok(profile);
    }
  );

  // ─── memory_profile_context (NEXT-004) ───────────────────────────
  ctx.server.registerTool(
    "memory_profile_context",
    {
      title: "Build Profile Context Block",
      description:
        "Build a compact context block from a user's profile for system prompt injection. " +
        "Token-budget-aware: limits output to approximately maxTokens. " +
        "Returns static + current dynamic facts in a <user-profile> XML block.",
      inputSchema: {
        userId: z.string().min(1).describe("User ID"),
        maxTokens: z.number().int().min(50).max(2000).default(500).optional().describe("Token budget (default: 500)"),
      },
    },
    async ({ userId, maxTokens }) => {
      const mgr = getProfileManager();
      const context = mgr.buildContextBlock(userId, maxTokens);
      if (!context) {
        return err(`Profile not found: ${userId}`);
      }
      return ok({ userId, context, tokens: Math.ceil(context.length / 3) });
    }
  );

  // ─── memory_context_assemble (NEXT-007) ──────────────────────────
  ctx.server.registerTool(
    "memory_context_assemble",
    {
      title: "Assemble Context",
      description:
        "Smart context assembly with RRF fusion. Combines knowledge base (BM25+vector), " +
        "temporal graph facts, and user profile into a single token-budget-aware context block. " +
        "Returns <context> XML block optimized for system prompt injection.",
      inputSchema: {
        query: z.string().min(1).describe("Query to assemble context for"),
        project: z.string().optional().describe("Project name"),
        userId: z.string().optional().describe("User ID for profile injection"),
        tokenBudget: z.number().int().min(100).max(8000).default(2000).optional().describe("Token budget (default: 2000)"),
        maxItems: z.number().int().min(1).max(50).default(20).optional().describe("Max items to include"),
        includeTemporal: z.boolean().default(true).optional().describe("Include temporal graph facts"),
        includeProfile: z.boolean().default(true).optional().describe("Include user profile"),
      },
    },
    async (args) => {
      const assembler = getContextAssembler();
      const result = await assembler.assemble({
        query: args.query,
        project: args.project ? resolveProject(args.project) : undefined,
        userId: args.userId,
        tokenBudget: args.tokenBudget,
        maxItems: args.maxItems,
        includeTemporal: args.includeTemporal,
        includeProfile: args.includeProfile,
      });
      return ok(result);
    }
  );

  // ─── memory_entity_search (NEXT-008) ─────────────────────────────
  ctx.server.registerTool(
    "memory_entity_search",
    {
      title: "Entity-linking Search",
      description:
        "Search memory facts by entity matching. Extracts entities from query " +
        "(capitalized words, CamelCase, snake_case, kebab-case, quoted strings) " +
        "and matches against entities in temporal graph facts. " +
        "Third retrieval signal alongside BM25 and vector search.",
      inputSchema: {
        query: z.string().min(1).describe("Query containing entity names"),
        limit: z.number().int().min(1).max(50).default(10).optional(),
      },
    },
    async ({ query, limit }) => {
      const retriever = getEntityRetriever();
      const results = retriever.retrieve(query, limit);
      return ok({
        count: results.length,
        results,
        extractedEntities: query.match(/\b[A-Z][a-zA-Z]{2,}\b|\b[a-z]+[A-Z][a-zA-Z]+\b|\b[a-z]+_[a-z_]+\b/g) ?? [],
      });
    }
  );

  // ─── memory_evolve (NEXT-003) ────────────────────────────────────
  ctx.server.registerTool(
    "memory_evolve",
    {
      title: "Evolve Memory",
      description:
        "Check a newly added fact against existing memories for semantic overlap. " +
        "Links related facts, merges similar ones, and supersedes contradictions. " +
        "Inspired by A-MEM (Zettelkasten) — new memories trigger updates to existing ones.",
      inputSchema: {
        factId: z.string().min(1).describe("ID of the newly added fact to evolve against existing memories"),
      },
    },
    async ({ factId }) => {
      const evolver = getMemoryEvolver();
      const result = evolver.evolve(factId);
      return ok(result);
    }
  );

  // ─── memory_check_conflicts (NEXT-009) ───────────────────────────
  ctx.server.registerTool(
    "memory_check_conflicts",
    {
      title: "Check Memory Conflicts",
      description:
        "Detect contradictions between a new fact and existing facts. " +
        "Uses negation patterns, entity overlap, and semantic similarity. " +
        "High-confidence conflicts auto-supersede old facts; low-confidence flagged for review.",
      inputSchema: {
        factId: z.string().min(1).describe("ID of the fact to check against existing memories"),
        checkAll: z.boolean().default(false).optional().describe("Check all facts for conflicts (not just the given one)"),
      },
    },
    async ({ factId, checkAll }) => {
      const resolver = getConflictResolver();
      if (checkAll) {
        const results = resolver.checkAllConflicts();
        return ok({ count: results.length, results });
      }
      const result = resolver.checkConflict(factId);
      return ok(result);
    }
  );

  // ─── memory_gc (NEXT-005) ────────────────────────────────────────
  ctx.server.registerTool(
    "memory_gc",
    {
      title: "Memory Garbage Collection",
      description:
        "Run forgetting GC on the temporal knowledge graph. " +
        "Expires facts past their TTL (per category), prunes noise (low confidence, no entities), " +
        "and identifies invalidated facts past retention for deletion. " +
        "Preferences/decisions/conventions/skills are permanent (TTL=null).",
      inputSchema: {},
    },
    async () => {
      const mgr = getForgettingManager();
      const result = mgr.runGC();
      return ok(result);
    }
  );

  // ─── memory_scope_filter (NEXT-010) ──────────────────────────────
  ctx.server.registerTool(
    "memory_scope_filter",
    {
      title: "Filter by Memory Scope",
      description:
        "Filter temporal graph facts by multi-tenancy scope dimensions " +
        "(userId, agentId, appId, runId). Returns only facts matching all specified dimensions. " +
        "Enables tenant isolation — different users/agents/apps see only their own memories.",
      inputSchema: {
        userId: z.string().optional().describe("Filter by user ID"),
        agentId: z.string().optional().describe("Filter by agent ID"),
        appId: z.string().optional().describe("Filter by app ID"),
        runId: z.string().optional().describe("Filter by run ID"),
        limit: z.number().int().min(1).max(200).default(50).optional(),
      },
    },
    async (args) => {
      const graph = getTemporalGraph();
      const allFacts = graph.query({ includeInvalidated: false, limit: 10000 });
      const matcher = new ScopeMatcher({
        userId: args.userId,
        agentId: args.agentId,
        appId: args.appId,
        runId: args.runId,
      });
      const filtered = matcher.filterItems(
        allFacts.map((f) => ({ ...f, scope: { userId: undefined, agentId: undefined, appId: undefined, runId: undefined } }))
      );
      return ok({
        count: filtered.length,
        scope: matcher.description,
        facts: filtered.slice(0, args.limit),
      });
    }
  );

  // ─── memory_scope_tags (NEXT-010) ────────────────────────────────
  ctx.server.registerTool(
    "memory_scope_tags",
    {
      title: "Build Scope Tags",
      description:
        "Generate scope tags for a given memory scope. " +
        "Tags can be attached to knowledge base documents for scope-based filtering. " +
        "Format: scope:user:<id>, scope:agent:<id>, scope:app:<id>, scope:run:<id>.",
      inputSchema: {
        userId: z.string().optional(),
        agentId: z.string().optional(),
        appId: z.string().optional(),
        runId: z.string().optional(),
      },
    },
    async (args) => {
      const tags = buildScopeTags({
        userId: args.userId,
        agentId: args.agentId,
        appId: args.appId,
        runId: args.runId,
      });
      return ok({ tags, count: tags.length });
    }
  );
}
