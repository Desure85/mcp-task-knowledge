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

  // Memory
  memory: {
    temporalQuery: (args?: { entity?: string; category?: string; tag?: string; includeInvalidated?: boolean; limit?: number }) =>
      callTool<{ count: number; facts: TemporalFact[] }>('memory_temporal_query', { ...(args ?? {}) }),
    temporalHistory: (factId: string) =>
      callTool<{ count: number; history: TemporalFact[] }>('memory_temporal_history', { factId }),
    entitySearch: (query: string, limit?: number) =>
      callTool<{ count: number; results: Array<{ statement: string; entities: string[]; score: number }>; extractedEntities: string[] }>(
        'memory_entity_search',
        { query, limit },
      ),
  },
};
