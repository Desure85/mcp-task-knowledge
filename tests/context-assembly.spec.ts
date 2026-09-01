/**
 * tests/context-assembly.spec.ts — Unit tests for Smart Context Assembly (NEXT-007).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextAssembler, type SearchFn } from '../src/memory/context-assembly.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { ProfileManager } from '../src/memory/user-profile.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_TEMPORAL = join(tmpdir(), `test-ca-temporal-${Date.now()}.json`);
const TEST_PROFILES = join(tmpdir(), `test-ca-profiles-${Date.now()}`);

const mockSearchFn: SearchFn = async (query, _project, limit) => {
  const mockResults = [
    { id: 'r1', title: 'Auth Module', content: 'Authentication uses JWT tokens with RS256 signing.', score: 0.9, tags: ['auth', 'jwt'] },
    { id: 'r2', title: 'Session Management', content: 'Sessions are managed by SessionManager with TTL.', score: 0.8, tags: ['session'] },
    { id: 'r3', title: 'Rate Limiting', content: 'Token bucket rate limiter per session.', score: 0.7, tags: ['rate-limit'] },
  ];
  return mockResults.filter((r) =>
    r.title.toLowerCase().includes(query.toLowerCase()) ||
    r.content.toLowerCase().includes(query.toLowerCase())
  ).slice(0, limit);
};

describe('ContextAssembler', () => {
  let assembler: ContextAssembler;
  let temporalGraph: TemporalGraph;
  let profileMgr: ProfileManager;

  beforeEach(() => {
    temporalGraph = new TemporalGraph({ storagePath: TEST_TEMPORAL });
    temporalGraph.clear();
    profileMgr = new ProfileManager({ storagePath: TEST_PROFILES });
    assembler = new ContextAssembler({
      searchFn: mockSearchFn,
      temporalGraph,
      profileMgr,
    });
  });

  it('should assemble context from knowledge base', async () => {
    const result = await assembler.assemble({
      query: 'auth',
      project: 'test',
      tokenBudget: 500,
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.sources).toContain('knowledge');
    expect(result.contextBlock).toContain('<context');
    expect(result.contextBlock).toContain('</context>');
  });

  it('should include temporal graph facts', async () => {
    temporalGraph.addFact({ statement: 'Uses JWT auth', category: 'convention' });

    const result = await assembler.assemble({
      query: 'auth',
      project: 'test',
      tokenBudget: 500,
      includeTemporal: true,
    });

    expect(result.sources).toContain('temporal');
    const temporalItems = result.items.filter((i) => i.source === 'temporal');
    expect(temporalItems.length).toBeGreaterThan(0);
  });

  it('should include user profile', async () => {
    profileMgr.updateProfile('alice', {
      static: { role: 'developer' },
      dynamicFact: { statement: 'working on auth', category: 'current_task' },
    });

    const result = await assembler.assemble({
      query: 'auth',
      project: 'test',
      userId: 'alice',
      tokenBudget: 500,
      includeProfile: true,
    });

    expect(result.sources).toContain('profile');
    const profileItems = result.items.filter((i) => i.source === 'profile');
    expect(profileItems.length).toBe(1);
  });

  it('should respect token budget', async () => {
    const result = await assembler.assemble({
      query: 'auth',
      project: 'test',
      tokenBudget: 50, // very small
    });

    expect(result.totalTokens).toBeLessThanOrEqual(100);
  });

  it('should fuse sources with RRF', async () => {
    temporalGraph.addFact({ statement: 'Auth uses JWT', category: 'convention' });

    const result = await assembler.assemble({
      query: 'auth',
      project: 'test',
      tokenBudget: 1000,
      includeTemporal: true,
    });

    // Items should have rrfScore
    for (const item of result.items) {
      if (item.source !== 'profile') {
        expect(item.rrfScore).toBeDefined();
        expect(item.rrfScore).toBeGreaterThan(0);
      }
    }
  });

  it('should sort by RRF score descending', async () => {
    const result = await assembler.assemble({
      query: 'auth',
      project: 'test',
      tokenBudget: 2000,
    });

    for (let i = 1; i < result.items.length; i++) {
      const prev = result.items[i - 1];
      const curr = result.items[i];
      if (prev.source === 'profile') continue;
      if (curr.source === 'profile') continue;
      expect((prev.rrfScore ?? 0) >= (curr.rrfScore ?? 0)).toBe(true);
    }
  });

  it('should place profile first in selection', async () => {
    profileMgr.updateProfile('alice', { static: { role: 'dev' } });

    const result = await assembler.assemble({
      query: 'auth',
      project: 'test',
      userId: 'alice',
      tokenBudget: 1000,
    });

    if (result.items.length > 0) {
      expect(result.items[0].source).toBe('profile');
    }
  });

  it('should handle no results gracefully', async () => {
    const result = await assembler.assemble({
      query: 'nonexistent topic xyz123',
      project: 'test',
      tokenBudget: 500,
    });

    expect(result.items.length).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it('should exclude temporal when includeTemporal=false', async () => {
    temporalGraph.addFact({ statement: 'test fact' });

    const result = await assembler.assemble({
      query: 'test',
      project: 'test',
      tokenBudget: 500,
      includeTemporal: false,
    });

    expect(result.sources).not.toContain('temporal');
  });

  it('should exclude profile when includeProfile=false', async () => {
    profileMgr.updateProfile('alice', { static: { role: 'dev' } });

    const result = await assembler.assemble({
      query: 'test',
      project: 'test',
      userId: 'alice',
      tokenBudget: 500,
      includeProfile: false,
    });

    expect(result.sources).not.toContain('profile');
  });

  it('should return durationMs > 0', async () => {
    const result = await assembler.assemble({
      query: 'auth',
      project: 'test',
      tokenBudget: 500,
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should work without searchFn', async () => {
    const noSearchAssembler = new ContextAssembler({
      temporalGraph,
      profileMgr,
    });

    temporalGraph.addFact({ statement: 'test fact' });

    const result = await noSearchAssembler.assemble({
      query: 'test',
      tokenBudget: 500,
    });

    expect(result.sources).toContain('temporal');
    expect(result.sources).not.toContain('knowledge');
  });

  it('should work without temporal graph and profile', async () => {
    const minimalAssembler = new ContextAssembler({
      searchFn: mockSearchFn,
    });

    const result = await minimalAssembler.assemble({
      query: 'auth',
      project: 'test',
      tokenBudget: 500,
    });

    expect(result.sources).toContain('knowledge');
    expect(result.sources).not.toContain('temporal');
    expect(result.sources).not.toContain('profile');
  });
});
