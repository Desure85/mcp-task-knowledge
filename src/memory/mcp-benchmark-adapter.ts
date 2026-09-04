/**
 * mcp-benchmark-adapter.ts — MemoryAdapter over a REAL MCP server instance (NEXT2-007).
 *
 * Bridges the in-process benchmark harness (`benchmarks.ts`: runBenchmark /
 * runAllBenchmarks) to a live server via MCP tools, so `npm run benchmark`
 * measures the actual storage + BM25 search stack instead of a mock:
 *
 * - add()     → `knowledge_bulk_create` (single-item batch)
 * - search()  → `search_knowledge` (BM25 + optional vector, server side)
 * - get()     → `knowledge_get`
 * - clear()   → project rotation (`<base>-0`, `<base>-1`, …). The runner calls
 *               clear() once per suite, so each suite gets an isolated project
 *               without needing delete tools. Stale projects live in the
 *               (usually ephemeral) DATA_DIR and are discarded with it.
 * - invalidate() → `knowledge_bulk_archive` (best-effort; the runner never
 *               calls it, temporal DMR scoring works via keyword match).
 *
 * Only depends on the minimal `BenchmarkMCPClient` surface, so unit tests can
 * use a fake and the CLI can pass the real MCP SDK Client.
 */

import {
  createBEAMSuite,
  createDMRSuite,
  createLOCOMOSuite,
  createLongMemEvalSuite,
  type BenchmarkFact,
  type BenchmarkResult,
  type BenchmarkSuite,
  type MemoryAdapter,
  type MemoryScope,
} from './benchmarks.js';

/** Minimal MCP client surface (the SDK `Client` satisfies this structurally). */
export interface BenchmarkMCPClient {
  callTool(args: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ content?: Array<{ type: string; text?: string }> }>;
}

export interface MCPMemoryAdapterOptions {
  /** Base project name; clear() appends `-<n>` per suite. Default: 'benchmark'. */
  baseProject?: string;
  /** Adapter label used in reports. Default: 'mcp-real-instance'. */
  name?: string;
}

interface KnowledgeDocShape {
  id: string;
  title?: string;
  content?: string;
  text?: string;
  tags?: string[];
}

interface SearchHitShape {
  id?: string;
  score?: number;
  item?: KnowledgeDocShape;
  title?: string;
  content?: string;
}

function readEnvelope<T>(text: string | undefined, tool: string): T {
  if (!text) throw new Error(`benchmark adapter: empty response from tool '${tool}'`);
  const env = JSON.parse(text) as { ok?: boolean; data?: T; error?: { message: string } };
  if (env?.ok !== true) {
    throw new Error(`benchmark adapter: tool '${tool}' failed: ${env?.error?.message ?? text.slice(0, 200)}`);
  }
  return env.data as T;
}

/**
 * MemoryAdapter implementation backed by a live MCP server instance.
 */
export class MCPMemoryAdapter implements MemoryAdapter {
  name: string;
  private readonly client: BenchmarkMCPClient;
  private readonly baseProject: string;
  private generation = 0;

  constructor(client: BenchmarkMCPClient, opts: MCPMemoryAdapterOptions = {}) {
    this.client = client;
    this.baseProject = opts.baseProject ?? 'benchmark';
    this.name = opts.name ?? 'mcp-real-instance';
  }

  /** Current (isolated) project — rotates on every clear(). */
  get project(): string {
    return `${this.baseProject}-${this.generation}`;
  }

  private async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.client.callTool({ name: tool, arguments: args });
    return readEnvelope<T>(res?.content?.[0]?.text, tool);
  }

  async add(item: BenchmarkFact): Promise<string> {
    const data = await this.call<{ count: number; created: KnowledgeDocShape[] }>(
      'knowledge_bulk_create',
      {
        project: this.project,
        items: [
          {
            title: item.title ?? item.content.substring(0, 80),
            content: item.content,
            tags: item.tags,
            type: 'note',
          },
        ],
      },
    );
    const created = data?.created?.[0];
    if (!created?.id) throw new Error('benchmark adapter: knowledge_bulk_create returned no id');
    return created.id;
  }

  async search(query: string, opts?: { limit?: number; scope?: MemoryScope }): Promise<BenchmarkResult[]> {
    void opts?.scope; // server-side search has no scope filter; isolation is per-project
    const data = await this.call<SearchHitShape[]>('search_knowledge', {
      project: this.project,
      query,
      limit: opts?.limit ?? 10,
    });
    if (!Array.isArray(data)) return [];
    return data.map((hit) => {
      const doc: KnowledgeDocShape = hit.item ?? { id: '' };
      return {
        id: hit.id ?? doc.id ?? crypto.randomUUID(),
        content: doc.content ?? hit.content ?? '',
        title: doc.title ?? hit.title,
        tags: doc.tags,
        score: typeof hit.score === 'number' ? hit.score : 0,
      };
    });
  }

  async get(id: string): Promise<BenchmarkFact | null> {
    try {
      const doc = await this.call<KnowledgeDocShape>('knowledge_get', {
        project: this.project,
        id,
      });
      if (!doc) return null;
      return {
        id: doc.id,
        content: doc.content ?? doc.text ?? '',
        title: doc.title,
        tags: doc.tags,
      };
    } catch {
      return null;
    }
  }

  async invalidate(id: string): Promise<void> {
    try {
      await this.call<unknown>('knowledge_bulk_archive', { project: this.project, ids: [id] });
    } catch {
      // Best-effort: archive tool may be unavailable; temporal scoring
      // in the harness does not depend on invalidate().
    }
  }

  async clear(): Promise<void> {
    // Project rotation: the next suite starts on a fresh, empty project.
    this.generation += 1;
  }
}

// ─── Suite selection ─────────────────────────────────────────────────────────

const SUITE_ALIASES: Record<string, () => BenchmarkSuite> = {
  locomo: createLOCOMOSuite,
  longmemeval: createLongMemEvalSuite,
  longmem: createLongMemEvalSuite,
  lme: createLongMemEvalSuite,
  beam: createBEAMSuite,
  dmr: createDMRSuite,
};

export const VALID_SUITE_SPECS = ['locomo', 'longmemeval', 'beam', 'dmr', 'all'] as const;

/**
 * Resolve a `--suite` spec (e.g. "all", "locomo", "beam,dmr") to suite instances.
 * Case-insensitive; `longmem`/`lme` are accepted as `longmemeval` aliases.
 * @throws Error listing valid values for unknown names.
 */
export function selectSuites(spec: string): BenchmarkSuite[] {
  const parts = spec
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (parts.length === 0 || parts.includes('all')) {
    return [createLOCOMOSuite(), createLongMemEvalSuite(), createBEAMSuite(), createDMRSuite()];
  }
  const unknown = parts.filter((p) => !(p in SUITE_ALIASES));
  if (unknown.length > 0) {
    throw new Error(
      `unknown benchmark suite(s): ${unknown.join(', ')}. Valid: ${VALID_SUITE_SPECS.join(', ')} (aliases: longmem, lme)`,
    );
  }
  return parts.map((p) => SUITE_ALIASES[p]());
}
