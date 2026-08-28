/**
 * memory/context-distiller.spec.ts — Tests for ContextDistiller (MEM-003).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SessionMemory } from './session-memory.js';
import { ContextDistiller } from './context-distiller.js';
import type { SessionRecord } from './session-memory.js';

let testDir: string;
let memory: SessionMemory;

function session(overrides: Partial<SessionRecord> & { id: string }): SessionRecord {
  return {
    startedAt: '2026-08-01T10:00:00.000Z',
    endedAt: '2026-08-01T11:00:00.000Z',
    summary: 'Implemented feature X',
    nextSteps: [],
    filesModified: ['src/a.ts'],
    decisions: [],
    conventions: [],
    metadata: {},
    ...overrides,
  };
}

describe('MEM-003: ContextDistiller', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `distill-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    memory = new SessionMemory({ filePath: join(testDir, 'mem.json') });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('distill()', () => {
    it('aggregates sessions with span and ids (oldest first)', () => {
      const distiller = new ContextDistiller();
      const knowledge = distiller.distill([
        session({ id: 's2', startedAt: '2026-08-02T10:00:00.000Z', endedAt: '2026-08-02T11:00:00.000Z' }),
        session({ id: 's1', startedAt: '2026-08-01T10:00:00.000Z', endedAt: '2026-08-01T11:00:00.000Z' }),
      ]);

      expect(knowledge.sessionIds).toEqual(['s1', 's2']);
      expect(knowledge.from).toBe('2026-08-01T10:00:00.000Z');
      expect(knowledge.to).toBe('2026-08-02T11:00:00.000Z');
    });

    it('extracts frequency-ranked topics without stop words', () => {
      const distiller = new ContextDistiller();
      const knowledge = distiller.distill([
        session({ id: 's1', summary: 'Implemented search search search across projects' }),
        session({ id: 's2', summary: 'Fixed search bugs in the projects' }),
      ]);

      expect(knowledge.topics[0]).toBe('search');
      expect(knowledge.topics).toContain('projects');
      expect(knowledge.topics).not.toContain('implemented'); // stop word (len>3 but generic)
    });

    it('aggregates decisions across sessions', () => {
      const distiller = new ContextDistiller();
      const knowledge = distiller.distill([
        session({ id: 's1', decisions: [{ title: 'Use vitest', decision: 'Switch to vitest', rationale: 'speed', timestamp: '2026-08-01' }] }),
        session({ id: 's2', decisions: [{ title: 'Use ESM', decision: 'Adopt ESM', rationale: 'modern', timestamp: '2026-08-02' }] }),
      ]);

      expect(knowledge.decisions.map((d) => d.title)).toEqual(['Use vitest', 'Use ESM']);
    });

    it('collects unique conventions and files', () => {
      const distiller = new ContextDistiller();
      const knowledge = distiller.distill([
        session({ id: 's1', conventions: ['Conventional commits'], filesModified: ['src/a.ts', 'src/b.ts'] }),
        session({ id: 's2', conventions: ['Conventional commits', 'No console.log'], filesModified: ['src/b.ts'] }),
      ]);

      expect(knowledge.conventions).toEqual(['Conventional commits', 'No console.log']);
      expect(knowledge.filesTouched).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('produces a summary mentioning topics and decisions', () => {
      const distiller = new ContextDistiller();
      const knowledge = distiller.distill([
        session({
          id: 's1',
          summary: 'Implemented search feature',
          decisions: [{ title: 'Use BM25', decision: 'BM25 scoring', rationale: 'r', timestamp: '2026-08-01' }],
        }),
      ]);

      expect(knowledge.summary).toContain('1 session');
      expect(knowledge.summary).toContain('search');
      expect(knowledge.summary).toContain('Use BM25');
    });

    it('returns an empty knowledge for no sessions', () => {
      const distiller = new ContextDistiller();
      const knowledge = distiller.distill([]);
      expect(knowledge.sessionIds).toEqual([]);
      expect(knowledge.summary).toContain('No sessions');
    });
  });

  describe('distillSession()', () => {
    it('distills a single session', () => {
      const distiller = new ContextDistiller();
      const knowledge = distiller.distillSession(session({ id: 's1', summary: 'Shipped auth module' }));
      expect(knowledge.sessionIds).toEqual(['s1']);
      expect(knowledge.topics).toContain('auth');
    });
  });

  describe('compressOldSessions()', () => {
    it('keeps recent sessions and compresses the rest', () => {
      memory.saveSession({
        summary: 'Session 1', nextSteps: [], filesModified: ['a.ts'], decisions: [], conventions: [], metadata: {},
        startedAt: '2026-08-01T10:00:00.000Z', endedAt: '2026-08-01T11:00:00.000Z',
      });
      memory.saveSession({
        summary: 'Session 2', nextSteps: [], filesModified: ['b.ts'], decisions: [], conventions: [], metadata: {},
        startedAt: '2026-08-02T10:00:00.000Z', endedAt: '2026-08-02T11:00:00.000Z',
      });
      memory.saveSession({
        summary: 'Session 3', nextSteps: [], filesModified: ['c.ts'], decisions: [], conventions: [], metadata: {},
        startedAt: '2026-08-03T10:00:00.000Z', endedAt: '2026-08-03T11:00:00.000Z',
      });

      const distiller = new ContextDistiller();
      const allIds = memory.getSessions(10).map((s) => s.id); // [s3, s2, s1]
      const result = distiller.compressOldSessions(memory, { keepRecent: 2 });

      expect(result.removed).toHaveLength(1);
      expect(result.removed[0]).toBe(allIds[2]); // oldest removed
      expect(result.compressed).toHaveLength(1);
      expect(result.compressed[0].sessionIds).toEqual([allIds[2]]);
      expect(memory.getStats().sessionCount).toBe(2);
    });

    it('supports olderThan cutoff', () => {
      memory.saveSession({
        summary: 'Old', nextSteps: [], filesModified: ['a.ts'], decisions: [], conventions: [], metadata: {},
        startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T11:00:00.000Z',
      });
      memory.saveSession({
        summary: 'Recent', nextSteps: [], filesModified: ['b.ts'], decisions: [], conventions: [], metadata: {},
        startedAt: '2026-08-01T10:00:00.000Z', endedAt: '2026-08-01T11:00:00.000Z',
      });

      const distiller = new ContextDistiller();
      const result = distiller.compressOldSessions(memory, { olderThan: '2026-07-15T00:00:00.000Z' });
      expect(result.removed).toHaveLength(1);
      expect(memory.getStats().sessionCount).toBe(1);
    });

    it('returns empty when nothing to compress', () => {
      memory.saveSession({
        summary: 'Only', nextSteps: [], filesModified: [], decisions: [], conventions: [], metadata: {},
        startedAt: '2026-08-01T10:00:00.000Z', endedAt: '2026-08-01T11:00:00.000Z',
      });
      const distiller = new ContextDistiller();
      const result = distiller.compressOldSessions(memory, { keepRecent: 3 });
      expect(result.removed).toEqual([]);
      expect(result.compressed).toEqual([]);
    });
  });
});
