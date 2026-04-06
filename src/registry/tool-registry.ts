/**
 * ToolRegistry with versioning, ETag and pagination (F-003)
 *
 * Wraps the raw Map<string, ToolMeta> from setup.ts and adds:
 *   - Auto-incrementing version counter (bumped on every register/remove)
 *   - ETag computed from version + tool count (fast cache validation)
 *   - Paginated listing with cursor support
 *   - Efficient snapshot for introspection
 */

import { createHash } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────

export interface ToolMeta {
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  handler?: (params: Record<string, unknown>) => Promise<unknown>;
  /** ISO timestamp when the tool was registered. */
  registeredAt?: string;
  /** ISO timestamp of last update (re-registration). */
  updatedAt?: string;
}

export interface ToolEntry {
  name: string;
  title: string | null;
  description: string | null;
  inputKeys: string[];
  registeredAt: string;
  updatedAt: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    /** Current page offset (0-based). */
    offset: number;
    /** Number of items returned. */
    limit: number;
    /** Total items matching the query. */
    total: number;
    /** Whether there are more items after this page. */
    hasMore: boolean;
  };
}

export interface RegistrySnapshot {
  version: number;
  etag: string;
  totalTools: number;
  toolNames: string[];
  /** ISO timestamp of last registry change. */
  lastChangedAt: string | null;
}

// ─── ToolRegistry ─────────────────────────────────────────────────────

export class ToolRegistry {
  private readonly store = new Map<string, ToolMeta>();
  private _version = 0;
  private _etag = '';
  private _lastChangedAt: string | null = null;

  constructor() {
    this._recomputeEtag();
  }

  // ─── Core operations ──────────────────────────────────────────────

  /**
   * Register or update a tool. Bumps version and recomputes ETag.
   */
  set(name: string, meta: ToolMeta): void {
    const now = new Date().toISOString();
    const existing = this.store.get(name);

    if (existing) {
      // Update existing: preserve registeredAt, bump updatedAt
      this.store.set(name, {
        ...meta,
        registeredAt: existing.registeredAt ?? now,
        updatedAt: now,
      });
    } else {
      // New tool
      this.store.set(name, {
        ...meta,
        registeredAt: now,
        updatedAt: now,
      });
    }

    this._version++;
    this._lastChangedAt = now;
    this._recomputeEtag();
  }

  /**
   * Get a single tool's metadata.
   */
  get(name: string): ToolMeta | undefined {
    return this.store.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.store.has(name);
  }

  /**
   * Remove a tool. Bumps version and recomputes ETag.
   */
  delete(name: string): boolean {
    const removed = this.store.delete(name);
    if (removed) {
      this._version++;
      this._lastChangedAt = new Date().toISOString();
      this._recomputeEtag();
    }
    return removed;
  }

  /**
   * Get all tool names (sorted).
   */
  names(): string[] {
    return Array.from(this.store.keys()).sort();
  }

  /**
   * Total number of registered tools.
   */
  get size(): number {
    return this.store.size;
  }

  // ─── Versioning & ETag ────────────────────────────────────────────

  /**
   * Current registry version (auto-incremented on every change).
   */
  get version(): number {
    return this._version;
  }

  /**
   * Current ETag — hash of version + tool count + sorted names.
   * Cheap to compute, changes on every register/remove.
   */
  get etag(): string {
    return this._etag;
  }

  /**
   * Check if a client-provided ETag still matches the current state.
   */
  isFresh(clientEtag: string): boolean {
    return clientEtag === this._etag;
  }

  /**
   * ISO timestamp of the last registry change.
   */
  get lastChangedAt(): string | null {
    return this._lastChangedAt;
  }

  /**
   * Get a lightweight snapshot of registry state.
   */
  snapshot(): RegistrySnapshot {
    return {
      version: this._version,
      etag: this._etag,
      totalTools: this.store.size,
      toolNames: this.names(),
      lastChangedAt: this._lastChangedAt,
    };
  }

  // ─── Paginated listing ────────────────────────────────────────────

  /**
   * List tools with pagination.
   *
   * @param options.offset - Start index (0-based, default 0)
   * @param options.limit - Items per page (default 20, max 100)
   * @param options.search - Optional substring filter on tool name
   */
  list(options?: { offset?: number; limit?: number; search?: string }): PaginatedResult<ToolEntry> {
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
    const search = options?.search?.trim().toLowerCase();

    let names = this.names();

    if (search) {
      names = names.filter((n) => n.toLowerCase().includes(search));
    }

    const total = names.length;
    const page = names.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    const data: ToolEntry[] = page.map((name) => {
      const meta = this.store.get(name)!;
      return {
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
        registeredAt: meta.registeredAt ?? '',
        updatedAt: meta.updatedAt ?? '',
      };
    });

    return {
      data,
      pagination: { offset, limit, total, hasMore },
    };
  }

  /**
   * Get a single tool entry (full metadata for introspection).
   */
  getEntry(name: string): ToolEntry | undefined {
    const meta = this.store.get(name);
    if (!meta) return undefined;
    return {
      name,
      title: meta.title ?? null,
      description: meta.description ?? null,
      inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
      registeredAt: meta.registeredAt ?? '',
      updatedAt: meta.updatedAt ?? '',
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private _recomputeEtag(): void {
    const names = Array.from(this.store.keys()).sort().join(',');
    const raw = `v${this._version}:n${this.store.size}:${names}`;
    this._etag = createHash('md5').update(raw).digest('hex').slice(0, 16);
  }

  // ─── Iterator support (for backwards compat) ──────────────────────

  entries(): IterableIterator<[string, ToolMeta]> {
    return this.store.entries();
  }

  [Symbol.iterator](): IterableIterator<[string, ToolMeta]> {
    return this.store[Symbol.iterator]();
  }

  forEach(callback: (value: ToolMeta, key: string, map: Map<string, ToolMeta>) => void): void {
    this.store.forEach(callback);
  }

  get [Symbol.toStringTag](): string {
    return 'ToolRegistry';
  }
}
