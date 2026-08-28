/**
 * memory/memory-io.spec.ts — Tests for MemoryIO (MEM-004).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionMemory } from './session-memory.js';
import { MemoryIO } from './memory-io.js';

let testDir: string;
let memory: SessionMemory;
let io: MemoryIO;

function seedMemory(): void {
  memory.saveSession({
    summary: 'Implemented search',
    nextSteps: ['Add ranking'],
    filesModified: ['src/search.ts'],
    decisions: [{ title: 'Use BM25', decision: 'BM25 scoring', rationale: 'speed', timestamp: '2026-08-01T00:00:00.000Z' }],
    conventions: ['Conventional commits'],
    metadata: {},
    startedAt: '2026-08-01T10:00:00.000Z',
    endedAt: '2026-08-01T11:00:00.000Z',
  });
  memory.addConvention('No console.log');
}

describe('MEM-004: MemoryIO', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `mem-io-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    memory = new SessionMemory({ filePath: join(testDir, 'mem.json') });
    io = new MemoryIO(memory);
    seedMemory();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('exportMarkdown()', () => {
    it('contains sessions, decisions, and conventions', () => {
      const md = io.exportMarkdown();
      expect(md).toContain('# Memory Export');
      expect(md).toContain('Implemented search');
      expect(md).toContain('Use BM25');
      expect(md).toContain('Conventional commits');
      expect(md).toContain('No console.log');
    });
  });

  describe('exportJson() / importJson()', () => {
    it('roundtrips sessions and conventions into a fresh memory', () => {
      const json = io.exportJson();
      const fresh = new SessionMemory({ filePath: join(testDir, 'fresh.json') });
      const freshIo = new MemoryIO(fresh);

      const summary = freshIo.importJson(json);
      expect(summary.sessionsImported).toBe(1);
      expect(summary.conventionsAdded).toBe(2);
      expect(fresh.getStats().sessionCount).toBe(1);
      expect(fresh.getConventions()).toContain('No console.log');
    });

    it('skips sessions with existing ids', () => {
      const json = io.exportJson();
      const summary = io.importJson(json);
      expect(summary.sessionsImported).toBe(0);
      expect(summary.skipped[0].reason).toContain('already exists');
    });

    it('reports invalid JSON', () => {
      const summary = io.importJson('{nope');
      expect(summary.skipped[0].reason).toContain('invalid JSON');
    });
  });

  describe('importConventionsFromText()', () => {
    it('extracts bullet conventions and frontmatter conventions', () => {
      const text = [
        '---',
        'conventions:',
        '  - Frontmatter rule',
        '---',
        '# Rules',
        '',
        '- Bullet rule one',
        '- Bullet rule two',
      ].join('\n');

      const summary = io.importConventionsFromText(text);
      expect(summary.conventionsAdded).toBe(3);
      expect(memory.getConventions()).toEqual(expect.arrayContaining(['Frontmatter rule', 'Bullet rule one', 'Bullet rule two']));
    });
  });

  describe('importFromClaudeDir() / importFromCursorDir()', () => {
    it('imports conventions from .claude markdown files', () => {
      mkdirSync(join(testDir, '.claude'), { recursive: true });
      writeFileSync(join(testDir, '.claude', 'CLAUDE.md'), '- Claude convention\n- Second claude rule\n');

      const summary = io.importFromClaudeDir(join(testDir, '.claude'));
      expect(summary.conventionsAdded).toBe(2);
      expect(memory.getConventions()).toContain('Claude convention');
    });

    it('imports conventions from .cursorrules files', () => {
      mkdirSync(join(testDir, '.cursor'), { recursive: true });
      writeFileSync(join(testDir, '.cursor', 'ts-strict.cursorrules'), '- Cursor rule one\n- Cursor rule two\n');

      const summary = io.importFromCursorDir(join(testDir, '.cursor'));
      expect(summary.conventionsAdded).toBe(2);
      expect(memory.getConventions()).toContain('Cursor rule one');
    });

    it('returns zero for a missing directory', () => {
      const summary = io.importFromClaudeDir(join(testDir, 'nope'));
      expect(summary.conventionsAdded).toBe(0);
    });
  });

  describe('importFromObsidianDir()', () => {
    it('imports type: convention documents', () => {
      mkdirSync(join(testDir, 'vault'), { recursive: true });
      writeFileSync(join(testDir, 'vault', 'conv.md'), [
        '---',
        'type: convention',
        '---',
        'Always use tabs',
      ].join('\n'));

      const summary = io.importFromObsidianDir(join(testDir, 'vault'));
      expect(summary.conventionsAdded).toBe(1);
      expect(memory.getConventions()).toContain('Always use tabs');
    });

    it('imports type: decision documents as sessions with decisions', () => {
      mkdirSync(join(testDir, 'vault'), { recursive: true });
      writeFileSync(join(testDir, 'vault', 'adr.md'), [
        '---',
        'type: decision',
        'title: Use vitest',
        'rationale: faster runner',
        'tags: [testing]',
        '---',
        'Switch the test runner to vitest.',
      ].join('\n'));

      const summary = io.importFromObsidianDir(join(testDir, 'vault'));
      expect(summary.decisionsImported).toBe(1);
      const decision = memory.getDecisions().find((d) => d.title === 'Use vitest')!;
      expect(decision).toBeDefined();
      expect(decision.decision).toContain('Switch the test runner to vitest.');
      expect(decision.tags).toEqual(['testing']);
    });
  });
});
