/**
 * tests/scoping.spec.ts — Unit tests for Memory Scoping (NEXT-010).
 */

import { describe, it, expect } from 'vitest';
import { ScopeMatcher, buildScopeTags } from '../src/memory/scoping.js';

describe('ScopeMatcher', () => {
  it('should match items with no scope (global)', () => {
    const matcher = new ScopeMatcher({ userId: 'alice' });
    expect(matcher.matches({ scope: undefined })).toBe(true);
  });

  it('should match items with same userId', () => {
    const matcher = new ScopeMatcher({ userId: 'alice' });
    expect(matcher.matches({ scope: { userId: 'alice' } })).toBe(true);
  });

  it('should not match items with different userId', () => {
    const matcher = new ScopeMatcher({ userId: 'alice' });
    expect(matcher.matches({ scope: { userId: 'bob' } })).toBe(false);
  });

  it('should match on all dimensions', () => {
    const matcher = new ScopeMatcher({ userId: 'alice', agentId: 'agent-1', appId: 'app-1', runId: 'run-1' });
    expect(matcher.matches({ scope: { userId: 'alice', agentId: 'agent-1', appId: 'app-1', runId: 'run-1' } })).toBe(true);
  });

  it('should not match if any dimension differs', () => {
    const matcher = new ScopeMatcher({ userId: 'alice', agentId: 'agent-1' });
    expect(matcher.matches({ scope: { userId: 'alice', agentId: 'agent-2' } })).toBe(false);
  });

  it('should match when filter dimension is undefined', () => {
    const matcher = new ScopeMatcher({ userId: 'alice' });
    expect(matcher.matches({ scope: { userId: 'alice', agentId: 'agent-1' } })).toBe(true);
  });

  it('should filter array of items', () => {
    const matcher = new ScopeMatcher({ userId: 'alice' });
    const items = [
      { scope: { userId: 'alice' }, data: 'a' },
      { scope: { userId: 'bob' }, data: 'b' },
      { scope: undefined, data: 'c' },
    ];
    const filtered = matcher.filterItems(items);
    expect(filtered.length).toBe(2);
  });

  it('should produce description string', () => {
    const matcher = new ScopeMatcher({ userId: 'alice', agentId: 'agent-1' });
    expect(matcher.description).toContain('user=alice');
    expect(matcher.description).toContain('agent=agent-1');
  });

  it('should produce global description for empty filter', () => {
    const matcher = new ScopeMatcher({});
    expect(matcher.description).toBe('global');
  });
});

describe('buildScopeTags', () => {
  it('should build tags for all dimensions', () => {
    const tags = buildScopeTags({ userId: 'alice', agentId: 'agent-1', appId: 'app-1', runId: 'run-1' });
    expect(tags).toContain('scope:user:alice');
    expect(tags).toContain('scope:agent:agent-1');
    expect(tags).toContain('scope:app:app-1');
    expect(tags).toContain('scope:run:run-1');
    expect(tags.length).toBe(4);
  });

  it('should build tags for partial dimensions', () => {
    const tags = buildScopeTags({ userId: 'alice' });
    expect(tags).toEqual(['scope:user:alice']);
  });

  it('should return empty for no dimensions', () => {
    const tags = buildScopeTags({});
    expect(tags.length).toBe(0);
  });
});
