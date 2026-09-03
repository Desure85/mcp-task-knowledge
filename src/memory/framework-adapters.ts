/**
 * framework-adapters.ts — Cross-framework portability adapters.
 *
 * Allows mcp-task-knowledge to be used as a memory provider for
 * LangGraph, AutoGen, CrewAI, and LangChain frameworks.
 *
 * Each adapter implements the framework's memory interface
 * and delegates to the MCP server via HTTP JSON-RPC.
 */

/// <reference types="node" />
import { createHash } from 'node:crypto';

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  content: string;
  title?: string;
  tags?: string[];
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchQuery {
  query: string;
  limit?: number;
  project?: string;
  scope?: Record<string, string>;
}

export interface MCPClient {
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

// ─── HTTP MCP Client ─────────────────────────────────────────────────────────

export class HttpMCPClient implements MCPClient {
  constructor(private url: string) {}

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: { name: tool, arguments: args },
    });

    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body,
    });

    if (!resp.ok) {
      throw new Error(`MCP HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
    }

    const contentType = resp.headers.get('content-type') ?? '';
    let json: unknown;

    if (contentType.includes('text/event-stream')) {
      const text = await resp.text();
      const dataLines = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6).trim());
      json = JSON.parse(dataLines.join('\n'));
    } else {
      json = await resp.json();
    }

    const rpcResp = json as { result?: { content?: Array<{ type: string; text: string }> }; error?: { message: string } };
    if (rpcResp.error) throw new Error(`MCP error: ${rpcResp.error.message}`);
    if (rpcResp.result?.content?.[0]?.text) {
      try { return JSON.parse(rpcResp.result.content[0].text); } catch { return rpcResp.result.content[0].text; }
    }
    return rpcResp.result;
  }
}

// ─── Wire Shapes ─────────────────────────────────────────────────────────────
// Real MCP wire shapes (must match src/register/search.ts + knowledge.ts):
//   search_knowledge → ok: Array<{ id, score, item: KnowledgeDoc }>
//   knowledge_list   → ok: Array<KnowledgeDocMeta> (metadata only, NO content)
// Legacy flat rows { id, title, content, score } are still tolerated.

interface SearchHitWire {
  id: string;
  score?: number;
  item?: { id?: string; title?: string; content?: string; tags?: string[] };
  title?: string;
  content?: string;
  tags?: string[];
}

interface DocMetaWire {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
}

// ─── Base Adapter ────────────────────────────────────────────────────────────

export abstract class FrameworkAdapter {
  abstract readonly framework: string;
  protected client: MCPClient;
  protected project: string;

  constructor(client: MCPClient, project: string) {
    this.client = client;
    this.project = project;
  }

  protected async mcpSearch(query: string, limit: number): Promise<MemoryItem[]> {
    const result = await this.client.call('search_knowledge', { project: this.project, query, limit });
    const r = result as { ok?: boolean; data?: unknown };
    if (!r?.ok || !Array.isArray(r.data)) return [];
    return (r.data as SearchHitWire[]).map((d) => {
      const doc = d.item ?? {};
      return {
        id: d.id ?? doc.id ?? '',
        content: doc.content ?? d.content ?? '',
        title: doc.title ?? d.title,
        tags: doc.tags ?? d.tags,
        score: d.score,
      };
    });
  }

  protected async mcpAdd(content: string, title: string, tags: string[]): Promise<string> {
    const result = await this.client.call('knowledge_bulk_create', {
      project: this.project,
      items: [{ title, content, type: 'note', tags }],
    });
    const r = result as { ok?: boolean; data?: { created: Array<{ id: string }> } };
    return r?.data?.created?.[0]?.id ?? crypto.randomUUID();
  }
}

// ─── LangGraph Adapter ───────────────────────────────────────────────────────

export class LangGraphMemoryAdapter extends FrameworkAdapter {
  readonly framework = 'langgraph';

  /**
   * LangGraph MemorySaver-compatible interface.
   * Returns checkpoint-like state for graph persistence.
   */
  async getCheckpoint(threadId: string): Promise<Record<string, unknown> | null> {
    const items = await this.mcpSearch(threadId, 1);
    if (items.length === 0) return null;
    try { return JSON.parse(items[0].content); } catch { return null; }
  }

  async putCheckpoint(threadId: string, state: Record<string, unknown>): Promise<void> {
    const content = JSON.stringify(state);
    await this.mcpAdd(content, `checkpoint:${threadId}`, ['checkpoint', 'langgraph']);
  }

  /**
   * Memory search for LangGraph nodes.
   */
  async search(query: string, limit = 5): Promise<MemoryItem[]> {
    return this.mcpSearch(query, limit);
  }
}

// ─── AutoGen Adapter ─────────────────────────────────────────────────────────

export class AutoGenMemoryAdapter extends FrameworkAdapter {
  readonly framework = 'autogen';
  private context: MemoryItem[] = [];

  /**
   * AutoGen update_context compatible interface.
   * Appends messages to context and stores in memory.
   */
  async updateContext(messages: Array<{ role: string; content: string }>): Promise<void> {
    for (const msg of messages) {
      const id = await this.mcpAdd(msg.content, `${msg.role}:message`, ['autogen', msg.role]);
      this.context.push({ id, content: msg.content, title: `${msg.role}:message`, tags: ['autogen', msg.role] });
    }
  }

  /**
   * Retrieve relevant context for AutoGen agents.
   */
  async retrieveContext(query: string, limit = 5): Promise<MemoryItem[]> {
    const searched = await this.mcpSearch(query, limit);
    return [...searched, ...this.context].slice(0, limit);
  }

  /**
   * Clear in-memory context (does not clear persistent storage).
   */
  clearContext(): void {
    this.context = [];
  }
}

// ─── CrewAI Adapter ──────────────────────────────────────────────────────────

export class CrewAIMemoryAdapter extends FrameworkAdapter {
  readonly framework = 'crewai';
  private dedupThreshold = 0.85;

  /**
   * CrewAI long-term memory: store with deduplication.
   */
  async addMemory(content: string, metadata?: Record<string, unknown>): Promise<string | null> {
    const existing = await this.mcpSearch(content, 5);
    for (const item of existing) {
      const sim = jaccardSimilarity(content.toLowerCase(), item.content.toLowerCase());
      if (sim >= this.dedupThreshold) return null;
    }
    const tags = ['crewai', 'longterm'];
    if (metadata?.agent) tags.push(`agent:${metadata.agent}`);
    return this.mcpAdd(content, content.substring(0, 80), tags);
  }

  /**
   * CrewAI entity memory: search for entity-related facts.
   */
  async searchEntity(entity: string, limit = 5): Promise<MemoryItem[]> {
    return this.mcpSearch(entity, limit);
  }

  /**
   * CrewAI short-term: recent N items.
   */
  async getRecent(limit = 10): Promise<MemoryItem[]> {
    const result = await this.client.call('knowledge_list', { project: this.project, limit });
    const r = result as { ok?: boolean; data?: unknown };
    if (!r?.ok || !Array.isArray(r.data)) return [];
    return (r.data as DocMetaWire[]).map((d) => ({ id: d.id, content: d.content ?? '', title: d.title, tags: d.tags }));
  }
}

// ─── LangChain Adapter ───────────────────────────────────────────────────────

export class LangChainMemoryAdapter extends FrameworkAdapter {
  readonly framework = 'langchain';
  private buffer: Array<{ role: string; content: string }> = [];

  /**
   * LangChain ConversationBufferMemory compatible.
   */
  async saveContext(input: string, output: string): Promise<void> {
    this.buffer.push({ role: 'human', content: input });
    this.buffer.push({ role: 'ai', content: output });
    await this.mcpAdd(`Human: ${input}\nAI: ${output}`, `conversation:${createHash('sha256').update(input).digest('hex').substring(0, 8)}`, ['langchain', 'conversation']);
  }

  /**
   * LangChain load_memory_variables compatible.
   */
  async loadMemoryVariables(query: string, limit = 5): Promise<{ history: string }> {
    const items = await this.mcpSearch(query, limit);
    const history = items.map((i) => i.content).join('\n\n');
    return { history };
  }

  /**
   * Clear buffer.
   */
  clear(): void {
    this.buffer = [];
  }
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const setB = new Set(b.split(/\s+/).filter((w) => w.length > 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) { if (setB.has(w)) intersection++; }
  return intersection / (setA.size + setB.size - intersection);
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export type FrameworkType = 'langgraph' | 'autogen' | 'crewai' | 'langchain';

export function createAdapter(framework: FrameworkType, client: MCPClient, project: string): FrameworkAdapter {
  switch (framework) {
    case 'langgraph': return new LangGraphMemoryAdapter(client, project);
    case 'autogen': return new AutoGenMemoryAdapter(client, project);
    case 'crewai': return new CrewAIMemoryAdapter(client, project);
    case 'langchain': return new LangChainMemoryAdapter(client, project);
  }
}
