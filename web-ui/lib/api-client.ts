/**
 * web-ui/lib/api-client.ts — Typed API client for MCP HTTP transport (UI-001, PH-015)
 *
 * Talks to the MCP server through the official SDK StreamableHTTP client:
 * initialize handshake → mcp-session-id reuse → optional mcp.authenticate.
 * Works both via the Next.js rewrite proxy (`/api/mcp`, same-origin — no
 * CORS needed) and against a direct absolute URL (requires MCP_CORS_ORIGIN
 * on the server).
 *
 * The underlying SDK transport parses `text/event-stream` responses, so
 * callers see plain MCP results — no manual SSE handling here.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

interface McpEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

/** Resolve the MCP endpoint — read lazily so tests/SSR can set env per call. */
export function resolveMcpApiUrl(): string {
  const raw = process.env.NEXT_PUBLIC_MCP_API_URL || '/api/mcp';
  if (/^https?:\/\//.test(raw)) return raw;
  if (typeof window !== 'undefined') return new URL(raw, window.location.origin).toString();
  // Node/test context without a window: keep the path absolute-usable by
  // letting callers pass a full URL via env in that environment.
  return raw;
}

const TOKEN_STORAGE_KEY = 'mcp.auth.token';

function resolveToken(): string | undefined {
  const envToken = process.env.NEXT_PUBLIC_MCP_TOKEN;
  if (envToken && envToken.trim().length > 0) return envToken;
  if (typeof window !== 'undefined') {
    const stored = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored && stored.trim().length > 0) return stored;
  }
  return undefined;
}

/**
 * Runtime auth: store the JWT for this tab and force re-auth on the next
 * call by dropping the connected client (SEC-003 gate requires an
 * authenticated session for non-whitelisted tools).
 */
export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  resetClient();
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  resetClient();
}

export function hasAuthToken(): boolean {
  return resolveToken() !== undefined;
}

let clientPromise: Promise<Client> | null = null;

/**
 * Lazily connected singleton client. One browser tab == one MCP session:
 * the SDK transport captures mcp-session-id at initialize and reuses it for
 * every subsequent call (PH-002b per-session transports require this).
 */
async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(resolveMcpApiUrl()));
      const client = new Client({ name: 'mcp-task-knowledge-web-ui', version: '0.1.0' });
      await client.connect(transport);
      const token = resolveToken();
      if (token) {
        const res = await client.callTool({ name: 'mcp.authenticate', arguments: { token } });
        const env = parseEnvelope(res);
        if (!env.ok) throw new Error(`mcp.authenticate failed: ${env.error?.message ?? 'unknown'}`);
      }
      return client;
    })();
    // A failed connect must not poison the singleton — retry next call.
    clientPromise.catch(() => { clientPromise = null; });
  }
  return clientPromise;
}

/** For tests: drop the cached client (e.g. after switching MCP_API_URL). */
export function resetClient(): void {
  clientPromise = null;
}

function parseEnvelope<T>(result: unknown): McpEnvelope<T> {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = content?.find((c) => c.type === 'text')?.text ?? '{}';
  try {
    return JSON.parse(text) as McpEnvelope<T>;
  } catch {
    return { ok: false, error: { message: 'non-JSON tool response' } };
  }
}

export async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = await getClient();
  const result = await client.callTool({ name, arguments: args });
  const env = parseEnvelope<T>(result);
  if (!env.ok) throw new Error(env.error?.message ?? `Tool ${name} failed`);
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
  project?: string;
  links?: string[];
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

// ─── Extended surface types (PH-015) ──────────────────────────────

export interface SessionEntry {
  sessionId: string;
  remote?: string;
  createdAt?: string;
  lastActivityAt?: string;
  ageMs?: number;
  idleMs?: number;
  ttlRemainingMs?: number | null;
  expiresAt?: number | null;
  rateLimit?: { remaining: number; maxTokens: number; refillPerSec: number; retryAfterSec: number } | null;
  metadata?: Record<string, unknown>;
}

export interface SessionListData {
  available: boolean;
  sessionsEnabled?: boolean;
  rateLimitingEnabled?: boolean;
  total: number;
  sessions: SessionEntry[];
}

export interface ToolListEntry {
  name: string;
  title?: string;
  description?: string;
  inputKeys?: string[];
}

export interface ToolListData {
  data?: ToolListEntry[];
  total?: number;
  pagination?: { total?: number };
}

export interface EmbeddingsStatus {
  mode?: string;
  dim?: number;
  model?: string;
  [k: string]: unknown;
}

export interface DagNode {
  id: string;
  title: string;
  status: string;
}

export interface DagData {
  project: string;
  totalTasks: number;
  tasksWithDeps: number;
  blockedCount: number;
  topologicalOrder: DagNode[];
  criticalPath: DagNode[];
  edges: Array<{ from: string; to: string }>;
}

export interface DashboardStats {
  project: string;
  period: { since: string | null; until: string | null };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    active: number;
    completed: number;
    blocked: number;
    completionRate: string;
    avgDaysOpen: number;
    withDependencies: number;
    withSubtasks: number;
    totalDependencies: number;
  };
  knowledge: { total: number; byType: Record<string, number> };
  tags: { unique: number; top: Array<{ tag: string; count: number }> };
}

export interface DashboardTrends {
  project: string;
  granularity: string;
  period: { since: string; days: number };
  daily: Array<{ date: string; created: number; completed: number; closed: number }>;
  cumulative: Array<{ date: string; totalCreated: number; totalCompleted: number; open: number }>;
  summary: { totalCreated: number; totalCompleted: number; totalClosed: number; netOpen: number };
}

export interface DashboardActivity {
  project: string;
  count: number;
  items: Array<{
    id: string;
    type: 'task' | 'knowledge';
    title: string;
    action: string;
    status?: string;
    priority?: string;
    updatedAt: string;
    createdAt: string;
  }>;
}

export interface PromptCatalogEntry {
  id: string;
  kind?: string;
  status?: string;
  domain?: string;
  title?: string;
  tags?: string[];
  latest?: string;
  versions?: string[];
}

export interface PromptCatalog {
  generatedAt?: string;
  items?: Record<string, PromptCatalogEntry>;
}

// ─── API methods ──────────────────────────────────────────────────

export const api = {
  // Tasks
  tasks: {
    list: (project?: string) => callTool<Task[]>('tasks_list', { project }),
    create: (input: { title: string; project?: string; priority?: string; tags?: string[]; parentId?: string; description?: string; links?: string[] }) =>
      callTool<Task>('tasks_create', input),
    get: (project: string, id: string) => callTool<Task>('tasks_get', { project, id }),
    update: (project: string, id: string, patch: Partial<Task>) =>
      callTool<Task>('tasks_update', { project, id, ...patch }),
    close: (project: string, id: string) => callTool<Task>('tasks_close', { project, id }),
    addSubtask: (project: string, parentId: string, title: string) =>
      callTool<Task>('tasks_add_subtask', { project, parentId, title }),
    getChildren: (project: string, id: string) => callTool<Task[]>('tasks_get_children', { project, id }),
    getSubtree: (project: string, id: string) => callTool<unknown>('tasks_get_subtree', { project, id }),
    bulkUpdate: (project: string, items: Array<{ id: string } & Record<string, unknown>>) =>
      callTool<{ count: number; results: Task[] }>('tasks_bulk_update', { project, items }),
    tree: (project?: string, status?: string) => callTool<unknown>('tasks_tree', { project, status }),
    dag: (project?: string) => callTool<DagData>('tasks_dag', { project }),
  },

  // Knowledge (single create/update are bulk-only server-side)
  knowledge: {
    list: (project?: string) => callTool<KnowledgeDoc[]>('knowledge_list', { project }),
    get: (project: string, id: string) => callTool<KnowledgeDoc>('knowledge_get', { project, id }),
    bulkCreate: (project: string, items: Array<{ title: string; content: string; tags?: string[]; type?: string }>) =>
      callTool<{ created: KnowledgeDoc[] }>('knowledge_bulk_create', { project, items }),
    bulkUpdate: (project: string, items: Array<{ id: string; title?: string; content?: string; tags?: string[]; source?: string; parentId?: string | null; type?: string }>) =>
      callTool<{ count: number; results: KnowledgeDoc[] }>('knowledge_bulk_update', { project, items }),
    bulkTrash: (project: string, ids: string[]) =>
      callTool<{ count: number; results: KnowledgeDoc[] }>('knowledge_bulk_trash', { project, ids }),
    bulkRestore: (project: string, ids: string[]) =>
      callTool<{ count: number; results: KnowledgeDoc[] }>('knowledge_bulk_restore', { project, ids }),
    bulkArchive: (project: string, ids: string[]) =>
      callTool<{ count: number; results: KnowledgeDoc[] }>('knowledge_bulk_archive', { project, ids }),
    bulkDeletePermanent: (project: string, ids: string[]) =>
      callTool<{ count: number; results: KnowledgeDoc[] }>('knowledge_bulk_delete_permanent', { project, ids }),
    tree: (project?: string) => callTool<unknown>('knowledge_tree', { project }),
    exportMarkdown: (project?: string) => callTool<unknown>('knowledge_export_markdown', { project }),
    exportBundle: (project?: string) => callTool<unknown>('knowledge_export_bundle', { project }),
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
    getCurrent: () => callTool<{ project: string; scope?: string }>('project_get_current', {}),
    setCurrent: (project: string) => callTool<{ project: string; scope?: string }>('project_set_current', { project }),
    create: (id: string, description?: string) => callTool<unknown>('project_create', { id, description }),
    update: (project: string, description: string) => callTool<unknown>('project_update', { project, description }),
    info: (project: string) => callTool<unknown>('project_info', { project }),
    remove: (project: string, force?: boolean) => callTool<unknown>('project_delete', { project, force }),
    purge: (project: string, confirm: boolean) => callTool<unknown>('project_purge', { project, confirm }),
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

  // Prompts (PH-015: shared client, catalog-aware)
  prompts: {
    list: (args?: { project?: string; kind?: string; status?: string; domain?: string; tag?: string[] }) =>
      callTool<{ total: number; items: Array<{ id: string; version: string; kind: string; status?: string; domain?: string; tags: string[]; file?: string }> }>(
        'prompts_list', { ...(args ?? {}) }),
    catalog: (project?: string) => callTool<PromptCatalog>('prompts_catalog_get', { project }),
    bulkCreate: (items: Array<Record<string, unknown>>, project?: string, overwrite?: boolean) =>
      callTool<unknown>('prompts_bulk_create', { items, project, overwrite }),
    variantsStats: (promptKey: string, project?: string) =>
      callTool<unknown>('prompts_variants_stats', { promptKey, project }),
    banditNext: (promptKey: string, project?: string) =>
      callTool<unknown>('prompts_bandit_next', { promptKey, project }),
    abReport: (project?: string) => callTool<unknown>('prompts_ab_report', { project }),
  },

  // System / ops surface (PH-015)
  system: {
    sessionList: () => callTool<SessionListData>('session_list', {}),
    sessionInfo: (sessionId: string) => callTool<unknown>('session_info', { sessionId }),
    embeddingsStatus: () => callTool<EmbeddingsStatus>('embeddings_status', {}),
    embeddingsTryInit: () => callTool<unknown>('embeddings_try_init', {}),
    toolsList: (search?: string, limit = 100, offset = 0) =>
      callTool<ToolListData>('tools_list', { ...(search ? { search } : {}), limit, offset }),
    toolHelp: (name: string) => callTool<unknown>('tool_help', { name }),
    toolSchema: (name: string) => callTool<unknown>('tool_schema', { name }),
    dashboardStats: (args?: { project?: string; since?: string; until?: string }) =>
      callTool<DashboardStats>('dashboard_stats', { ...(args ?? {}) }),
    dashboardTrends: (args?: { project?: string; days?: number; granularity?: 'day' | 'week' }) =>
      callTool<DashboardTrends>('dashboard_trends', { ...(args ?? {}) }),
    dashboardProjectSummary: () => callTool<unknown>('dashboard_project_summary', {}),
    dashboardActivity: (args?: { project?: string; limit?: number; type?: 'all' | 'tasks' | 'knowledge' }) =>
      callTool<DashboardActivity>('dashboard_activity', { ...(args ?? {}) }),
  },
};
