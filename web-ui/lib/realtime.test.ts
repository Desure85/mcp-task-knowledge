/**
 * Unit tests for pure helpers in lib/realtime.ts (PH-015d).
 * No WebSocket / React rendering — only pure functions.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRealtimeUrl,
  backoffDelay,
  applyTaskEvent,
  applyKnowledgeEvent,
  connectionBadgeClass,
  connectionBadgeLabel,
  type RealtimeEvent,
} from './realtime';

describe('resolveRealtimeUrl', () => {
  it('explicit wsUrl wins as-is', () => {
    expect(resolveRealtimeUrl({ wsUrl: 'wss://x.test/custom' })).toBe('wss://x.test/custom');
  });

  it('absolute http apiUrl → ws://same-origin/ws', () => {
    expect(resolveRealtimeUrl({ apiUrl: 'http://localhost:3001/mcp' }))
      .toBe('ws://localhost:3001/ws');
  });

  it('absolute https apiUrl → wss://same-origin/ws', () => {
    expect(resolveRealtimeUrl({ apiUrl: 'https://mcp.example.com/api' }))
      .toBe('wss://mcp.example.com/ws');
  });

  it('relative apiUrl + origin → same-origin /ws', () => {
    expect(resolveRealtimeUrl({ apiUrl: '/api/mcp', locationOrigin: 'https://ui.example.com' }))
      .toBe('wss://ui.example.com/ws');
  });

  it('no inputs → /ws fallback', () => {
    expect(resolveRealtimeUrl({})).toBe('/ws');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially from base', () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(2)).toBe(4000);
  });

  it('caps at maxMs', () => {
    expect(backoffDelay(20)).toBe(30_000);
  });
});

describe('applyTaskEvent', () => {
  const base = [{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }];

  it('task.created appends new task', () => {
    const ev: RealtimeEvent = { type: 'task.created', data: { id: 't3', title: 'C' } };
    const next = applyTaskEvent(base, ev);
    expect(next).toHaveLength(3);
    expect(next[2].id).toBe('t3');
  });

  it('task.updated merges fields into existing task', () => {
    const ev: RealtimeEvent = { type: 'task.updated', data: { id: 't1', status: 'completed' } };
    const next = applyTaskEvent(base, ev);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: 't1', title: 'A', status: 'completed' });
  });

  it('task.deleted removes task', () => {
    const ev: RealtimeEvent = { type: 'task.deleted', data: { id: 't1' } };
    expect(applyTaskEvent(base, ev).map((t) => t.id)).toEqual(['t2']);
  });

  it('task.deleted on unknown id returns same array (no-op)', () => {
    const ev: RealtimeEvent = { type: 'task.deleted', data: { id: 'nope' } };
    expect(applyTaskEvent(base, ev)).toBe(base);
  });

  it('ignores unrelated event types', () => {
    const ev: RealtimeEvent = { type: 'knowledge.created', data: { id: 'k1' } };
    expect(applyTaskEvent(base, ev)).toBe(base);
  });

  it('accepts nested payload under data.task', () => {
    const ev: RealtimeEvent = { type: 'task.created', data: { task: { id: 't9', title: 'nested' } } };
    const next = applyTaskEvent(base, ev);
    expect(next[2].id).toBe('t9');
  });
});

describe('applyKnowledgeEvent', () => {
  const base = [{ id: 'k1', title: 'Doc' }];

  it('knowledge.created appends', () => {
    const ev: RealtimeEvent = { type: 'knowledge.created', data: { id: 'k2' } };
    expect(applyTaskEvent.length).toBeGreaterThan(0); // sanity
    expect(applyKnowledgeEvent(base, ev)).toHaveLength(2);
  });

  it('knowledge.deleted removes', () => {
    const ev: RealtimeEvent = { type: 'knowledge.deleted', data: { id: 'k1' } };
    expect(applyKnowledgeEvent(base, ev)).toHaveLength(0);
  });

  it('ignores task.* events', () => {
    const ev: RealtimeEvent = { type: 'task.created', data: { id: 't1' } };
    expect(applyKnowledgeEvent(base, ev)).toBe(base);
  });
});

describe('connectionBadge', () => {
  it('maps statuses to distinct classes', () => {
    expect(connectionBadgeClass('connected')).toContain('green');
    expect(connectionBadgeClass('reconnecting')).toContain('yellow');
    expect(connectionBadgeClass('unavailable')).toContain('gray');
  });

  it('label includes presence count when connected', () => {
    expect(connectionBadgeLabel('connected', 3)).toBe('● Live (3 online)');
    expect(connectionBadgeLabel('connected')).toBe('● Live');
    expect(connectionBadgeLabel('unavailable')).toBe('○ Offline');
  });
});
