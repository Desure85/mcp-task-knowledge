/**
 * skills/skill-pipeline.spec.ts — Tests for SkillPipeline (SK-002).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SkillManager } from './skill-manager.js';
import { SkillPipeline } from './skill-pipeline.js';
import type { Skill } from './types.js';

let testDir: string;
let manager: SkillManager;

function seedSkills(): void {
  manager.create({
    name: 'code-review',
    description: 'Review code for quality issues',
    body: 'Review the following files: $ARGUMENTS\nBranch: ${branch}',
    tags: ['quality'],
    frontmatter: { triggers: ['code review', 'review code'], context: 'main' },
  });
  manager.create({
    name: 'deploy',
    description: 'Deploy to production',
    body: 'Deploying $ARGUMENTS.target to ${env}',
    tags: ['devops'],
    frontmatter: { triggers: ['deploy'] },
  });
  manager.create({
    name: 'research',
    description: 'Research a topic',
    body: 'Research ${topic} and summarize findings.',
    frontmatter: { context: 'fork', triggers: ['research', 'investigate'] },
  });
}

describe('SK-002: SkillPipeline', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `skill-pipe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new SkillManager({ storagePath: testDir });
    seedSkills();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('invoke()', () => {
    it('renders ${VARS} and $ARGUMENTS into the body', async () => {
      const pipe = new SkillPipeline(manager);
      const result = await pipe.invoke('code-review', {
        arguments: { files: 'src/index.ts' },
        variables: { branch: 'main' },
      });

      expect(result.ok).toBe(true);
      expect(result.output).toContain('Review the following files: src/index.ts');
      expect(result.output).toContain('Branch: main');
      expect(result.skillId).toBe('code-review');
      expect(result.version).toBe('1.0.0');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.fork).toBe(false);
    });

    it('renders $ARGUMENTS.<name> placeholders', async () => {
      const pipe = new SkillPipeline(manager);
      const result = await pipe.invoke('deploy', {
        arguments: { target: 'prod' },
        variables: { env: 'production' },
      });

      expect(result.ok).toBe(true);
      expect(result.output).toBe('Deploying prod to production');
    });

    it('throws on unknown skill', async () => {
      const pipe = new SkillPipeline(manager);
      await expect(pipe.invoke('nope')).rejects.toThrow(/skill not found/);
    });

    it('throws on archived skill', async () => {
      manager.update('code-review', { status: 'archived' });
      const pipe = new SkillPipeline(manager);
      await expect(pipe.invoke('code-review')).rejects.toThrow(/not invocable/);
    });
  });

  describe('match()', () => {
    it('finds skills by trigger keywords', () => {
      const pipe = new SkillPipeline(manager);
      const matches = pipe.match('please run a code review on this PR');

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skill.id).toBe('code-review');
      expect(matches[0].score).toBeGreaterThan(0);
    });

    it('returns nothing when no triggers match', () => {
      const pipe = new SkillPipeline(manager);
      const matches = pipe.match('what is the weather today');
      expect(matches).toEqual([]);
    });

    it('sorts matches by score descending', () => {
      const pipe = new SkillPipeline(manager);
      const matches = pipe.match('research and deploy the code review');
      expect(matches.length).toBeGreaterThan(1);
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
      }
    });
  });

  describe('shell execution (!command)', () => {
    it('does not execute commands when shell is disabled', async () => {
      const runner = vi.fn(async () => 'pwd-output');
      manager.create({
        name: 'sys-info',
        description: 'Gather system info',
        body: '!pwd\nDone.',
        frontmatter: {},
      });
      const pipe = new SkillPipeline(manager, { shellRunner: runner });
      const result = await pipe.invoke('sys-info');

      expect(runner).not.toHaveBeenCalled();
      expect(result.warnings.some((w) => w.includes('shell disabled'))).toBe(true);
      expect(result.executedCommands).toEqual([]);
      expect(result.output).toContain('!pwd');
    });

    it('executes commands when shell is enabled and inlines output', async () => {
      const runner = vi.fn(async (cmd: string) => `${cmd}-output`);
      manager.create({
        name: 'sys-info',
        description: 'Gather system info',
        body: '!pwd\nDone.',
        frontmatter: {},
      });
      const pipe = new SkillPipeline(manager, { shellRunner: runner });
      const result = await pipe.invoke('sys-info', { allowShell: true });

      expect(runner).toHaveBeenCalledWith('pwd');
      expect(result.executedCommands).toEqual(['pwd']);
      expect(result.output).toContain('pwd-output');
      expect(result.output).toContain('Done.');
      expect(result.ok).toBe(true);
    });

    it('records shell command failures as warnings', async () => {
      const runner = vi.fn(async () => { throw new Error('boom'); });
      manager.create({
        name: 'sys-info',
        description: 'Gather system info',
        body: '!pwd\nDone.',
        frontmatter: {},
      });
      const pipe = new SkillPipeline(manager, { shellRunner: runner });
      const result = await pipe.invoke('sys-info', { allowShell: true });

      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.includes('shell command failed'))).toBe(true);
      expect(result.output).toContain('shell error');
    });
  });

  describe('fork context', () => {
    it('produces a self-contained subagent task instead of inline execution', async () => {
      const runner = vi.fn(async () => 'should-not-run');
      const pipe = new SkillPipeline(manager, { shellRunner: runner });
      const result = await pipe.invoke('research', {
        arguments: { depth: 'deep' },
        variables: { topic: 'vector search' },
        allowShell: true,
      });

      expect(result.fork).toBe(true);
      expect(result.executedCommands).toEqual([]);
      expect(runner).not.toHaveBeenCalled();
      expect(result.output).toContain('# research');
      expect(result.output).toContain('Research a topic');
      expect(result.output).toContain('Research vector search and summarize findings.');
      expect(result.output).toContain('"depth": "deep"');
    });
  });
});
