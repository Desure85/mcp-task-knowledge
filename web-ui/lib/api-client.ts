/**
 * web-ui/lib/api-client.ts — Typed API client for MCP HTTP transport (UI-001)
 *
 * Connects to the MCP server's HTTP transport and provides typed methods
 * for tasks, knowledge, search, and projects.
 */

const MCP_API_URL = process.env.NEXT_PUBLIC_MCP_API_URL || '/api/mcp';

interface McpResponse<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(MCP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: Date.now(),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const text = json?.result?.content?.[0]?.text ?? '{}';
  const env = JSON.parse(text) as McpResponse<T>;
  if (!env.ok) throw new Error(env.error?.message ?? 'Unknown error');
  return env.data as T;
}

// ─── Types ────────────────────────────────────────────────────────

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'closed';
  priority: 'low' | 'medium' | 'high';
  tags?: string[];
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  type?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  id: string;
  score: number;
  item: unknown;
}

export interface ProjectInfo {
  id: string;
  isDefault?: boolean;
  isCurrent?: boolean;
  hasTasks?: boolean;
  hasKnowledge?: boolean;
}

export interface FactRelationship {
  targetId: string;
  type: 'supersedes' | 'contradicts' | 'supports' | 'related' | 'causes' | 'derived';
  metadata?: Record<string, unknown>;
}

export interface TemporalFact {
  id: string;
  statement: string;
  category: string;
  confidence: number;
  tags: string[];
  entities: string[];
  validFrom: string;
  validTo?: string;
  recordedAt: string;
  valid: boolean;
  supersededBy?: string;
  invalidationReason?: string;
  relationships: FactRelationship[];
}

export interface TemporalStats {
  totalFacts: number;
  validFacts: number;
  invalidatedFacts: number;
  categories: Record<string, number>;
}

export interface MemoryFactMeta {
  id: string;
  title: string;
  type?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryFactHit {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  score: number;
}

export interface StaticFactEntry {
  key: string;
  value: string;
  setAt: string;
}

export interface DynamicFactEntry {
  id: string;
  statement: string;
  category: string;
  validFrom: string;
  validTo?: string;
  valid: boolean;
}

export interface UserProfile {
  userId: string;
  static: Record<string, StaticFactEntry>;
  dynamic: DynamicFactEntry[];
  createdAt: string;
  updatedAt: string;
}

export type MemoryLayerName = 'conversation' | 'session' | 'user';

export interface LayeredFact {
  id: string;
  layer: MemoryLayerName;
  statement: string;
  category: string;
  confidence: number;
  tags: string[];
  createdAt: string;
  valid: boolean;
}

// ─── API methods ──────────────────────────────────────────────────

export const api = {
  // Tasks
  tasks: {
    list: (project?: string) => callTool<Task[]>('tasks_list', { project }),
    create: (input: { title: string; project?: string; priority?: string; tags?: string[] }) =>
      callTool<Task>('tasks_create', input),
    get: (project: string, id: string) => callTool<Task>('tasks_get', { project, id }),
    update: (project: string, id: string, patch: Partial<Task>) =>
      callTool<Task>('tasks_update', { project, id, ...patch }),
    close: (project: string, id: string) => callTool<Task>('tasks_close', { project, id }),
  },

  // Knowledge
  knowledge: {
    list: (project?: string) => callTool<KnowledgeDoc[]>('knowledge_list', { project }),
    get: (project: string, id: string) => callTool<KnowledgeDoc>('knowledge_get', { project, id }),
    bulkCreate: (project: string, items: Array<{ title: string; content: string; tags?: string[]; type?: string }>) =>
      callTool<{ created: KnowledgeDoc[] }>('knowledge_bulk_create', { project, items }),
  },

  // Search
  search: {
    tasks: (query: string, project?: string, limit?: number) =>
      callTool<SearchResult[]>('search_tasks', { query, project, limit }),
    knowledge: (query: string, project?: string, limit?: number) =>
      callTool<SearchResult[]>('search_knowledge', { query, project, limit }),
  },

  // Projects
  projects: {
    list: () => callTool<{ projects: ProjectInfo[]; current: string }>('project_list', {}),
    getCurrent: () => callTool<{ project: string }>('project_get_current', {}),
    setCurrent: (project: string) => callTool<{ project: string }>('project_set_current', { project }),
  },

  // Memory (NEXT2-004)
  memory: {
    factsList: (args?: { project?: string; tag?: string; category?: string; limit?: number }) =>
      callTool<{ count: number; facts: MemoryFactMeta[] }>('memory_facts_list', { ...(args ?? {}) }),
    factsSearch: (query: string, args?: { project?: string; limit?: number }) =>
      callTool<{ count: number; results: MemoryFactHit[] }>('memory_facts_search', { query, ...(args ?? {}) }),
    temporalQuery: (args?: { atTime?: string; entity?: string; category?: string; tag?: string; includeInvalidated?: boolean; limit?: number }) =>
      callTool<{ count: number; facts: TemporalFact[] }>('memory_temporal_query', { ...(args ?? {}) }),
    temporalHistory: (factId: string) =>
      callTool<{ count: number; history: TemporalFact[] }>('memory_temporal_history', { factId }),
    temporalStats: () =>
      callTool<TemporalStats>('memory_temporal_stats', {}),
    entitySearch: (query: string, limit?: number) =>
      callTool<{ count: number; results: Array<{ statement: string; entities: string[]; score: number }>; extractedEntities: string[] }>(
        'memory_entity_search',
        { query, limit },
      ),
    profileGet: (userId: string) =>
      callTool<UserProfile>('memory_profile_get', { userId }),
    profileContext: (userId: string, maxTokens?: number) =>
      callTool<{ userId: string; context: string; tokens: number }>('memory_profile_context', { userId, maxTokens }),
    layerList: (layer: MemoryLayerName) =>
      callTool<{ count: number; facts: LayeredFact[] }>('memory_layer_list', { layer }),
    layerStats: () =>
      callTool<Record<MemoryLayerName, { total: number; valid: number }>>('memory_layer_stats', {}),
  },
};
