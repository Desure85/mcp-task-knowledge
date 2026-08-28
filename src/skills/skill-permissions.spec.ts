/**
 * skills/skill-permissions.spec.ts — Tests for SkillPermissions (SK-006).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SkillManager } from './skill-manager.js';
import { SkillPermissions } from './skill-permissions.js';
import { SkillPipeline } from './skill-pipeline.js';

let testDir: string;
let manager: SkillManager;
let perms: SkillPermissions;

function seedSkills(): void {
  manager.create({
    name: 'open-skill',
    description: 'd',
    body: 'Body',
    frontmatter: {},
  });
  manager.create({
    name: 'user-only',
    description: 'd',
    body: 'Body',
    frontmatter: { 'disable-model-invocation': true },
  });
  manager.create({
    name: 'scoped',
    description: 'd',
    body: 'Body',
    frontmatter: { scope: 'user' },
  });
  manager.create({
    name: 'restricted-tools',
    description: 'd',
    body: 'Body',
    frontmatter: { 'allowed-tools': ['git:checkout', 'lint'] },
  });
  manager.create({
    name: 'restricted-args',
    description: 'd',
    body: 'Body',
    frontmatter: { allowedArguments: ['file', 'branch'] },
  });
}

describe('SK-006: SkillPermissions', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `skill-perm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new SkillManager({ storagePath: testDir });
    perms = new SkillPermissions(manager);
    seedSkills();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('canInvoke()', () => {
    it('allows by default (no restrictions)', () => {
      expect(perms.canInvoke('open-skill').allowed).toBe(true);
    });

    it('denies model invocation when disable-model-invocation is set', () => {
      const decision = perms.canInvoke('user-only', { by: 'model' });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('disables model invocation');
    });

    it('allows user invocation when disable-model-invocation is set', () => {
      expect(perms.canInvoke('user-only', { by: 'user' }).allowed).toBe(true);
    });

    it('enforces scope hierarchy', () => {
      // user-scope skill is not available in a project context
      expect(perms.canInvoke('scoped', { scope: 'project' }).allowed).toBe(false);
      // but is available in a user context
      expect(perms.canInvoke('scoped', { scope: 'user' }).allowed).toBe(true);
      // global skills are available everywhere
      expect(perms.canInvoke('open-skill', { scope: 'user' }).allowed).toBe(true);
    });

    it('returns not-allowed for unknown skills', () => {
      expect(perms.canInvoke('nope').allowed).toBe(false);
    });
  });

  describe('canUseTool()', () => {
    it('allows all tools when allowed-tools is absent', () => {
      expect(perms.canUseTool('open-skill', 'anything').allowed).toBe(true);
    });

    it('allows listed tools and denies others', () => {
      expect(perms.canUseTool('restricted-tools', 'git:checkout').allowed).toBe(true);
      expect(perms.canUseTool('restricted-tools', 'rm-rf').allowed).toBe(false);
    });

    it('supports the * wildcard', () => {
      manager.create({
        name: 'wild',
        description: 'd',
        body: 'b',
        frontmatter: { 'allowed-tools': ['*'] },
      });
      expect(perms.canUseTool('wild', 'anything').allowed).toBe(true);
    });
  });

  describe('checkArgs()', () => {
    it('allows all args when allowed-arguments is absent', () => {
      expect(perms.checkArgs('open-skill', { secret: 'x' }).allowed).toBe(true);
    });

    it('denies args not in the allowlist', () => {
      const decision = perms.checkArgs('restricted-args', { file: 'a.ts', secret: 'x' });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('secret');
    });

    it('allows only listed args', () => {
      expect(perms.checkArgs('restricted-args', { file: 'a.ts', branch: 'main' }).allowed).toBe(true);
    });
  });

  describe('checkInvocation()', () => {
    it('combines invocation and argument checks', () => {
      const ok = perms.checkInvocation('restricted-args', { file: 'a.ts' }, { by: 'user', scope: 'global' });
      expect(ok.allowed).toBe(true);
      expect(ok.violations).toEqual([]);

      const denied = perms.checkInvocation('user-only', { file: 'a.ts' }, { by: 'model' });
      expect(denied.allowed).toBe(false);
      expect(denied.violations[0].field).toBe('invocation');
    });
  });

  describe('SkillPipeline integration', () => {
    it('blocks invocation when permissions deny it', async () => {
      const pipe = new SkillPipeline(manager, { permissions: perms });
      await expect(pipe.invoke('user-only')).rejects.toThrow(/permission denied/);
    });

    it('allows invocation when permissions pass', async () => {
      const pipe = new SkillPipeline(manager, { permissions: perms });
      const result = await pipe.invoke('open-skill');
      expect(result.ok).toBe(true);
    });

    it('user caller can invoke a model-disabled skill', async () => {
      const pipe = new SkillPipeline(manager, { permissions: perms });
      const result = await pipe.invoke('user-only', { caller: { by: 'user' } });
      expect(result.ok).toBe(true);
    });
  });
});
