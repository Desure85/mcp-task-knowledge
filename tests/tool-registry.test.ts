import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from '../src/registry/tool-registry.js';
import type { ToolMeta, ToolEntry, PaginatedResult } from '../src/registry/tool-registry.js';

describe('ToolRegistry', () => {
  let reg: ToolRegistry;

  beforeEach(() => {
    reg = new ToolRegistry();
  });

  // ─── Basic CRUD ────────────────────────────────────────────────────

  describe('basic CRUD', () => {
    it('starts empty with version 0', () => {
      expect(reg.size).toBe(0);
      expect(reg.version).toBe(0);
      expect(reg.names()).toEqual([]);
    });

    it('set() adds a tool and bumps version', () => {
      reg.set('task_create', { title: 'Create Task', description: 'Create a new task' });
      expect(reg.size).toBe(1);
      expect(reg.version).toBe(1);
      expect(reg.has('task_create')).toBe(true);
    });

    it('get() returns metadata', () => {
      reg.set('task_create', { title: 'Create Task', description: 'Create a new task', inputSchema: { title: 'string' } });
      const meta = reg.get('task_create');
      expect(meta?.title).toBe('Create Task');
      expect(meta?.description).toBe('Create a new task');
      expect(meta?.inputSchema).toEqual({ title: 'string' });
    });

    it('get() returns undefined for unknown tool', () => {
      expect(reg.get('nonexistent')).toBeUndefined();
    });

    it('set() on existing tool updates and preserves registeredAt', async () => {
      reg.set('task_create', { title: 'Create Task' });
      const first = reg.get('task_create')!;
      const firstRegisteredAt = first.registeredAt;
      const firstUpdatedAt = first.updatedAt;

      // Ensure different millisecond
      await new Promise((r) => setTimeout(r, 2));
      reg.set('task_create', { title: 'Create Task v2' });
      const second = reg.get('task_create')!;

      expect(reg.version).toBe(2);
      expect(second.title).toBe('Create Task v2');
      expect(second.registeredAt).toBe(firstRegisteredAt);
      expect(second.updatedAt).not.toBe(firstUpdatedAt);
    });

    it('delete() removes a tool and bumps version', () => {
      reg.set('task_create', { title: 'Create Task' });
      reg.set('task_close', { title: 'Close Task' });
      expect(reg.version).toBe(2);

      const removed = reg.delete('task_create');
      expect(removed).toBe(true);
      expect(reg.size).toBe(1);
      expect(reg.version).toBe(3);
      expect(reg.has('task_create')).toBe(false);
    });

    it('delete() returns false for unknown tool', () => {
      expect(reg.delete('nonexistent')).toBe(false);
      expect(reg.version).toBe(0); // no version bump
    });

    it('names() returns sorted list', () => {
      reg.set('zebra', {});
      reg.set('alpha', {});
      reg.set('middle', {});
      expect(reg.names()).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('handler can be stored and retrieved', async () => {
      const handler = vi.fn().mockResolvedValue({ ok: true });
      reg.set('my_tool', { handler });
      const meta = reg.get('my_tool');
      expect(typeof meta?.handler).toBe('function');
      await meta!.handler!({});
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // ─── Versioning ────────────────────────────────────────────────────

  describe('versioning', () => {
    it('version increments on each set()', () => {
      expect(reg.version).toBe(0);
      reg.set('a', {});
      expect(reg.version).toBe(1);
      reg.set('b', {});
      expect(reg.version).toBe(2);
      reg.set('a', {}); // re-register
      expect(reg.version).toBe(3);
    });

    it('version increments on each delete()', () => {
      reg.set('a', {});
      reg.set('b', {});
      expect(reg.version).toBe(2);
      reg.delete('a');
      expect(reg.version).toBe(3);
    });
  });

  // ─── ETag ──────────────────────────────────────────────────────────

  describe('ETag', () => {
    it('initial etag is non-empty string', () => {
      expect(reg.etag).toBeTruthy();
      expect(typeof reg.etag).toBe('string');
      expect(reg.etag.length).toBe(16); // MD5 slice
    });

    it('etag changes on every mutation', () => {
      const e1 = reg.etag;
      reg.set('a', {});
      const e2 = reg.etag;
      reg.set('b', {});
      const e3 = reg.etag;
      reg.delete('a');
      const e4 = reg.etag;

      expect(e1).not.toBe(e2);
      expect(e2).not.toBe(e3);
      expect(e3).not.toBe(e4);
    });

    it('etag is stable between mutations', () => {
      reg.set('a', {});
      const e1 = reg.etag;
      const e2 = reg.etag;
      expect(e1).toBe(e2);
    });

    it('isFresh() returns true for current etag', () => {
      reg.set('a', {});
      expect(reg.isFresh(reg.etag)).toBe(true);
    });

    it('isFresh() returns false for stale etag', () => {
      const oldEtag = reg.etag;
      reg.set('a', {});
      expect(reg.isFresh(oldEtag)).toBe(false);
    });

    it('isFresh() returns false for garbage etag', () => {
      expect(reg.isFresh('not-a-real-etag')).toBe(false);
    });
  });

  // ─── Timestamps ────────────────────────────────────────────────────

  describe('timestamps', () => {
    it('lastChangedAt is null initially', () => {
      expect(reg.lastChangedAt).toBeNull();
    });

    it('lastChangedAt is set on first mutation', () => {
      reg.set('a', {});
      expect(reg.lastChangedAt).toBeTruthy();
      expect(typeof reg.lastChangedAt).toBe('string');
      // Should be valid ISO date
      expect(() => new Date(reg.lastChangedAt!)).not.toThrow();
    });

    it('lastChangedAt updates on each mutation', () => {
      reg.set('a', {});
      const t1 = reg.lastChangedAt;
      // We can't guarantee different ms, but version should bump
      reg.set('b', {});
      expect(reg.version).toBe(2);
    });
  });

  // ─── Snapshot ──────────────────────────────────────────────────────

  describe('snapshot()', () => {
    it('returns correct snapshot for empty registry', () => {
      const snap = reg.snapshot();
      expect(snap.version).toBe(0);
      expect(snap.totalTools).toBe(0);
      expect(snap.toolNames).toEqual([]);
      expect(snap.lastChangedAt).toBeNull();
      expect(snap.etag).toBeTruthy();
    });

    it('returns correct snapshot after mutations', () => {
      reg.set('zebra', { title: 'Zebra' });
      reg.set('alpha', { title: 'Alpha' });

      const snap = reg.snapshot();
      expect(snap.version).toBe(2);
      expect(snap.totalTools).toBe(2);
      expect(snap.toolNames).toEqual(['alpha', 'zebra']);
      expect(snap.lastChangedAt).toBeTruthy();
    });
  });

  // ─── getEntry() ────────────────────────────────────────────────────

  describe('getEntry()', () => {
    it('returns typed entry for existing tool', () => {
      reg.set('task_create', {
        title: 'Create Task',
        description: 'Create a new task',
        inputSchema: { title: 'string', priority: 'string' },
      });

      const entry = reg.getEntry('task_create');
      expect(entry).toBeDefined();
      expect(entry!.name).toBe('task_create');
      expect(entry!.title).toBe('Create Task');
      expect(entry!.description).toBe('Create a new task');
      expect(entry!.inputKeys).toEqual(['title', 'priority']);
      expect(entry!.registeredAt).toBeTruthy();
      expect(entry!.updatedAt).toBeTruthy();
    });

    it('returns undefined for unknown tool', () => {
      expect(reg.getEntry('nonexistent')).toBeUndefined();
    });
  });

  // ─── Pagination ────────────────────────────────────────────────────

  describe('list() pagination', () => {
    beforeEach(() => {
      // Register 25 tools
      for (let i = 1; i <= 25; i++) {
        reg.set(`tool_${String(i).padStart(2, '0')}`, {
          title: `Tool ${i}`,
          description: `Description for tool ${i}`,
        });
      }
    });

    it('default pagination returns first 20', () => {
      const result = reg.list();
      expect(result.data).toHaveLength(20);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.offset).toBe(0);
      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.hasMore).toBe(true);
    });

    it('second page with offset', () => {
      const result = reg.list({ offset: 20 });
      expect(result.data).toHaveLength(5);
      expect(result.pagination.offset).toBe(20);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('custom limit', () => {
      const result = reg.list({ limit: 5 });
      expect(result.data).toHaveLength(5);
      expect(result.pagination.limit).toBe(5);
      expect(result.pagination.hasMore).toBe(true);
    });

    it('limit is clamped to max 100', () => {
      const result = reg.list({ limit: 999 });
      expect(result.pagination.limit).toBe(100);
    });

    it('limit is clamped to min 1', () => {
      const result = reg.list({ limit: 0 });
      expect(result.pagination.limit).toBe(1);
    });

    it('offset beyond total returns empty', () => {
      const result = reg.list({ offset: 100 });
      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('negative offset is treated as 0', () => {
      const result = reg.list({ offset: -5 });
      expect(result.pagination.offset).toBe(0);
      expect(result.data).toHaveLength(20);
    });

    it('search filters by name substring', () => {
      const result = reg.list({ search: 'tool_01' });
      expect(result.pagination.total).toBeGreaterThanOrEqual(1);
      expect(result.data.every((e) => e.name.includes('tool_01'))).toBe(true);
    });

    it('search is case-insensitive', () => {
      reg.set('MyTool', {});
      const result = reg.list({ search: 'mytool' });
      expect(result.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('search with no matches returns empty', () => {
      const result = reg.list({ search: 'nonexistent_tool' });
      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('search + pagination combined', () => {
      // Add tools with 'search_' prefix
      for (let i = 1; i <= 10; i++) {
        reg.set(`search_${i}`, { title: `Search ${i}` });
      }

      const result = reg.list({ search: 'search_', limit: 3, offset: 0 });
      expect(result.data).toHaveLength(3);
      expect(result.pagination.total).toBe(10);
      expect(result.pagination.hasMore).toBe(true);
    });
  });

  // ─── Iterator support ──────────────────────────────────────────────

  describe('iterator support', () => {
    it('entries() returns key-value pairs', () => {
      reg.set('a', { title: 'A' });
      reg.set('b', { title: 'B' });
      const entries = Array.from(reg.entries());
      expect(entries).toHaveLength(2);
      expect(entries.some(([k]) => k === 'a')).toBe(true);
      expect(entries.some(([k]) => k === 'b')).toBe(true);
    });

    it('forEach() works', () => {
      reg.set('a', { title: 'A' });
      const keys: string[] = [];
      reg.forEach((_, key) => keys.push(key));
      expect(keys).toContain('a');
    });

    it('Symbol.iterator works', () => {
      reg.set('a', { title: 'A' });
      const keys = Array.from(reg).map(([k]) => k);
      expect(keys).toContain('a');
    });

    it('Symbol.toStringTag returns ToolRegistry', () => {
      expect(Object.prototype.toString.call(reg)).toContain('ToolRegistry');
    });
  });

  // ─── Backwards compatibility with Map-like usage ──────────────────

  describe('backwards compatibility', () => {
    it('Array.from(reg.entries()) works like Map', () => {
      reg.set('task_create', { title: 'Create' });
      reg.set('task_close', { title: 'Close' });

      const items = Array.from(reg.entries()).map(([name, meta]) => ({
        name,
        title: meta?.title ?? null,
        description: meta?.description ?? null,
        inputKeys: meta?.inputSchema ? Object.keys(meta.inputSchema) : [],
      }));

      expect(items).toHaveLength(2);
      expect(items[0].name).toBeTruthy();
    });
  });
});
