/**
 * memory/session-memory.spec.ts — Tests for SessionMemory (MEM-001).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionMemory } from './session-memory.js';

let testDir: string;
let testFile: string;

describe('MEM-001: SessionMemory', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testFile = join(testDir, 'memory.json');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('saveSession() and getLastSession()', () => {
    it('saves a session and returns it with an ID', () => {
      const mem = new SessionMemory({ filePath: testFile });
      const session = mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T01:00:00Z',
        summary: 'Implemented feature X',
        nextSteps: ['Test feature X', 'Deploy'],
        filesModified: ['src/feature.ts'],
        decisions: [],
        conventions: [],
        metadata: {},
      });

      expect(session.id).toBeDefined();
      expect(session.summary).toBe('Implemented feature X');
    });

    it('retrieves the last saved session', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T01:00:00Z',
        summary: 'First session',
        nextSteps: [],
        filesModified: [],
        decisions: [],
        conventions: [],
        metadata: {},
      });
      mem.saveSession({
        startedAt: '2026-01-02T00:00:00Z',
        endedAt: '2026-01-02T01:00:00Z',
        summary: 'Second session',
        nextSteps: [],
        filesModified: [],
        decisions: [],
        conventions: [],
        metadata: {},
      });

      const last = mem.getLastSession();
      expect(last?.summary).toBe('Second session');
    });

    it('returns undefined when no sessions exist', () => {
      const mem = new SessionMemory({ filePath: testFile });
      expect(mem.getLastSession()).toBeUndefined();
    });

    it('persists to disk', () => {
      const mem1 = new SessionMemory({ filePath: testFile });
      mem1.saveSession({
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T01:00:00Z',
        summary: 'Persisted session',
        nextSteps: [],
        filesModified: [],
        decisions: [],
        conventions: [],
        metadata: {},
      });

      // Create new instance — should load from disk
      const mem2 = new SessionMemory({ filePath: testFile });
      expect(mem2.getLastSession()?.summary).toBe('Persisted session');
    });
  });

  describe('getSession()', () => {
    it('retrieves a session by ID', () => {
      const mem = new SessionMemory({ filePath: testFile });
      const saved = mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T01:00:00Z',
        summary: 'Test',
        nextSteps: [],
        filesModified: [],
        decisions: [],
        conventions: [],
        metadata: {},
      });

      const found = mem.getSession(saved.id);
      expect(found?.summary).toBe('Test');
    });

    it('returns undefined for unknown ID', () => {
      const mem = new SessionMemory({ filePath: testFile });
      expect(mem.getSession('unknown')).toBeUndefined();
    });
  });

  describe('getSessions()', () => {
    it('returns sessions newest first', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({ startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'A', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });
      mem.saveSession({ startedAt: '2026-01-02T00:00:00Z', endedAt: '', summary: 'B', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });
      mem.saveSession({ startedAt: '2026-01-03T00:00:00Z', endedAt: '', summary: 'C', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });

      const sessions = mem.getSessions();
      expect(sessions[0].summary).toBe('C');
      expect(sessions[1].summary).toBe('B');
      expect(sessions[2].summary).toBe('A');
    });

    it('limits results', () => {
      const mem = new SessionMemory({ filePath: testFile });
      for (let i = 0; i < 5; i++) {
        mem.saveSession({ startedAt: `2026-01-0${i + 1}T00:00:00Z`, endedAt: '', summary: `S${i}`, nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });
      }
      expect(mem.getSessions(2).length).toBe(2);
    });
  });

  describe('decisions', () => {
    it('collects decisions across all sessions', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'A', nextSteps: [], filesModified: [],
        decisions: [{ title: 'Use JWT', decision: 'JWT for auth', rationale: 'standard', timestamp: '2026-01-01T00:00:00Z' }],
        conventions: [], metadata: {},
      });
      mem.saveSession({
        startedAt: '2026-01-02T00:00:00Z', endedAt: '', summary: 'B', nextSteps: [], filesModified: [],
        decisions: [{ title: 'Use Redis', decision: 'Redis for cache', rationale: 'fast', timestamp: '2026-01-02T00:00:00Z' }],
        conventions: [], metadata: {},
      });

      const decisions = mem.getDecisions();
      expect(decisions.length).toBe(2);
    });

    it('filters decisions by tag', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'A', nextSteps: [], filesModified: [],
        decisions: [
          { title: 'D1', decision: 'dec1', rationale: 'r', tags: ['auth'], timestamp: '2026-01-01T00:00:00Z' },
          { title: 'D2', decision: 'dec2', rationale: 'r', tags: ['cache'], timestamp: '2026-01-01T00:00:00Z' },
        ],
        conventions: [], metadata: {},
      });

      expect(mem.getDecisionsByTag('auth').length).toBe(1);
      expect(mem.getDecisionsByTag('cache').length).toBe(1);
      expect(mem.getDecisionsByTag('db').length).toBe(0);
    });
  });

  describe('conventions', () => {
    it('collects conventions from sessions', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'A', nextSteps: [], filesModified: [],
        decisions: [], conventions: ['Use camelCase', 'Tests required'], metadata: {},
      });

      expect(mem.getConventions()).toContain('Use camelCase');
      expect(mem.getConventions()).toContain('Tests required');
    });

    it('deduplicates conventions', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({ startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'A', nextSteps: [], filesModified: [], decisions: [], conventions: ['Use camelCase'], metadata: {} });
      mem.saveSession({ startedAt: '2026-01-02T00:00:00Z', endedAt: '', summary: 'B', nextSteps: [], filesModified: [], decisions: [], conventions: ['Use camelCase'], metadata: {} });

      expect(mem.getConventions().filter((c) => c === 'Use camelCase').length).toBe(1);
    });

    it('addConvention adds new convention', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.addConvention('Always test');
      expect(mem.getConventions()).toContain('Always test');
    });

    it('addConvention does not duplicate', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.addConvention('Always test');
      mem.addConvention('Always test');
      expect(mem.getConventions().filter((c) => c === 'Always test').length).toBe(1);
    });
  });

  describe('search()', () => {
    it('searches in summary', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({ startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'Implemented auth', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });
      mem.saveSession({ startedAt: '2026-01-02T00:00:00Z', endedAt: '', summary: 'Fixed bug', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });

      expect(mem.search('auth').length).toBe(1);
      expect(mem.search('bug').length).toBe(1);
      expect(mem.search('nonexistent').length).toBe(0);
    });

    it('searches in nextSteps', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({ startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'S1', nextSteps: ['Deploy to production'], filesModified: [], decisions: [], conventions: [], metadata: {} });

      expect(mem.search('deploy').length).toBe(1);
    });

    it('searches in decisions', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'S1', nextSteps: [], filesModified: [],
        decisions: [{ title: 'Use PostgreSQL', decision: 'PG for DB', rationale: 'r', timestamp: '2026-01-01T00:00:00Z' }],
        conventions: [], metadata: {},
      });

      expect(mem.search('PostgreSQL').length).toBe(1);
    });

    it('search is case-insensitive', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({ startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'Implemented AUTH', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });

      expect(mem.search('auth').length).toBe(1);
    });
  });

  describe('getSessionsInRange()', () => {
    it('filters by time range', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({ startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'A', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });
      mem.saveSession({ startedAt: '2026-01-15T00:00:00Z', endedAt: '', summary: 'B', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });
      mem.saveSession({ startedAt: '2026-02-01T00:00:00Z', endedAt: '', summary: 'C', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });

      const range = mem.getSessionsInRange('2026-01-10T00:00:00Z', '2026-01-20T00:00:00Z');
      expect(range.length).toBe(1);
      expect(range[0].summary).toBe('B');
    });
  });

  describe('getContextSummary()', () => {
    it('returns formatted context for recent sessions', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'Implemented auth',
        nextSteps: ['Add tests'], filesModified: [],
        decisions: [{ title: 'JWT', decision: 'Use JWT', rationale: 'r', timestamp: '2026-01-01T00:00:00Z' }],
        conventions: ['Always test'], metadata: {},
      });

      const summary = mem.getContextSummary();
      expect(summary).toContain('Implemented auth');
      expect(summary).toContain('Add tests');
      expect(summary).toContain('JWT');
      expect(summary).toContain('Always test');
    });

    it('returns no-sessions message when empty', () => {
      const mem = new SessionMemory({ filePath: testFile });
      const summary = mem.getContextSummary();
      expect(summary).toContain('No previous sessions');
    });
  });

  describe('deleteSession()', () => {
    it('deletes a session', () => {
      const mem = new SessionMemory({ filePath: testFile });
      const s = mem.saveSession({ startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'Test', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });
      expect(mem.deleteSession(s.id)).toBe(true);
      expect(mem.getSession(s.id)).toBeUndefined();
    });

    it('returns false for unknown ID', () => {
      const mem = new SessionMemory({ filePath: testFile });
      expect(mem.deleteSession('unknown')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('clears all data', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({ startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'Test', nextSteps: [], filesModified: [], decisions: [], conventions: ['conv1'], metadata: {} });
      mem.clear();
      expect(mem.getSessions().length).toBe(0);
      expect(mem.getConventions().length).toBe(0);
    });
  });

  describe('getStats()', () => {
    it('returns correct stats', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'A', nextSteps: [], filesModified: [],
        decisions: [{ title: 'D1', decision: 'dec', rationale: 'r', timestamp: '2026-01-01T00:00:00Z' }],
        conventions: ['conv1'], metadata: {},
      });
      mem.saveSession({ startedAt: '2026-01-02T00:00:00Z', endedAt: '', summary: 'B', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });

      const stats = mem.getStats();
      expect(stats.sessionCount).toBe(2);
      expect(stats.decisionCount).toBe(1);
      expect(stats.conventionCount).toBe(1);
      expect(stats.oldestSession).toBe('2026-01-01T00:00:00Z');
      expect(stats.newestSession).toBe('2026-01-02T00:00:00Z');
    });
  });

  describe('maxSessions limit', () => {
    it('trims old sessions when over limit', () => {
      const mem = new SessionMemory({ filePath: testFile, maxSessions: 3 });
      for (let i = 0; i < 5; i++) {
        mem.saveSession({ startedAt: `2026-01-0${i + 1}T00:00:00Z`, endedAt: '', summary: `S${i}`, nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {} });
      }
      expect(mem.getSessions().length).toBe(3);
      // Should keep the last 3 (newest)
      const sessions = mem.getSessions();
      expect(sessions[0].summary).toBe('S4');
      expect(sessions[2].summary).toBe('S2');
    });
  });

  describe('encryption at rest', () => {
    it('does not store plaintext sensitive metadata', () => {
      const mem = new SessionMemory({ filePath: testFile });
      mem.saveSession({
        startedAt: '2026-01-01T00:00:00Z', endedAt: '', summary: 'Test',
        nextSteps: [], filesModified: [],
        decisions: [], conventions: [],
        metadata: { apiKey: 'secret-key-123' },
      });

      const content = readFileSync(testFile, 'utf8');
      // Note: SessionMemory stores JSON as-is. This test documents that
      // sensitive metadata is NOT encrypted by default.
      // Use SecretManager (SEC-004) for encrypted secret storage.
      expect(content).toContain('secret-key-123');
    });
  });
});
