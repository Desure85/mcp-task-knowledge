/**
 * tests/user-profile.spec.ts — Unit tests for User Profiles (NEXT-004).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfileManager } from '../src/memory/user-profile.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `test-profiles-${Date.now()}`);

describe('ProfileManager', () => {
  let mgr: ProfileManager;

  beforeEach(() => {
    mgr = new ProfileManager({ storagePath: TEST_DIR });
  });

  afterEach(async () => {
    try { await fsp.rm(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should return null for non-existent profile', () => {
    expect(mgr.getProfile('alice')).toBeNull();
  });

  it('should create a profile with static facts', () => {
    const profile = mgr.updateProfile('alice', {
      static: { role: 'developer', name: 'Alice' },
    });

    expect(profile.userId).toBe('alice');
    expect(profile.static['role'].value).toBe('developer');
    expect(profile.static['name'].value).toBe('Alice');
  });

  it('should add dynamic facts', () => {
    const profile = mgr.updateProfile('alice', {
      dynamicFact: { statement: 'working on auth module', category: 'current_task' },
    });

    expect(profile.dynamic.length).toBe(1);
    expect(profile.dynamic[0].statement).toBe('working on auth module');
    expect(profile.dynamic[0].valid).toBe(true);
  });

  it('should invalidate previous dynamic fact of same category', () => {
    mgr.updateProfile('alice', {
      dynamicFact: { statement: 'task A', category: 'current_task' },
    });
    mgr.updateProfile('alice', {
      dynamicFact: { statement: 'task B', category: 'current_task' },
    });

    const profile = mgr.getProfile('alice')!;
    const validFacts = profile.dynamic.filter((f) => f.valid);
    expect(validFacts.length).toBe(1);
    expect(validFacts[0].statement).toBe('task B');
  });

  it('should allow multiple categories of dynamic facts', () => {
    mgr.updateProfile('alice', {
      dynamicFact: { statement: 'task A', category: 'current_task' },
    });
    mgr.updateProfile('alice', {
      dynamicFact: { statement: 'use PostgreSQL', category: 'recent_decision' },
    });

    const profile = mgr.getProfile('alice')!;
    const validFacts = profile.dynamic.filter((f) => f.valid);
    expect(validFacts.length).toBe(2);
  });

  it('should update existing static fact', () => {
    mgr.updateProfile('alice', { static: { role: 'developer' } });
    mgr.updateProfile('alice', { static: { role: 'senior developer' } });

    const profile = mgr.getProfile('alice')!;
    expect(profile.static['role'].value).toBe('senior developer');
  });

  it('should build context block', () => {
    mgr.updateProfile('alice', {
      static: { role: 'developer', name: 'Alice' },
      dynamicFact: { statement: 'working on auth', category: 'current_task' },
    });

    const context = mgr.buildContextBlock('alice', 500);
    expect(context).toContain('<user-profile');
    expect(context).toContain('role: developer');
    expect(context).toContain('working on auth');
    expect(context).toContain('</user-profile>');
  });

  it('should return empty string for non-existent profile', () => {
    expect(mgr.buildContextBlock('nobody', 500)).toBe('');
  });

  it('should respect token budget', () => {
    mgr.updateProfile('alice', {
      static: { role: 'dev', name: 'A' },
    });
    for (let i = 0; i < 20; i++) {
      mgr.updateProfile('alice', {
        dynamicFact: { statement: `dynamic fact number ${i} with some text`, category: `cat${i}` },
      });
    }

    const context = mgr.buildContextBlock('alice', 50); // very small budget
    // Should be truncated to fit ~150 chars (50 tokens * 3)
    expect(context.length).toBeLessThan(500);
  });

  it('should list users', () => {
    mgr.updateProfile('alice', { static: { role: 'dev' } });
    mgr.updateProfile('bob', { static: { role: 'pm' } });

    const users = mgr.listUsers();
    expect(users).toContain('alice');
    expect(users).toContain('bob');
  });

  it('should persist and reload', () => {
    mgr.updateProfile('alice', { static: { role: 'developer' } });

    const mgr2 = new ProfileManager({ storagePath: TEST_DIR });
    const profile = mgr2.getProfile('alice');
    expect(profile).not.toBeNull();
    expect(profile!.static['role'].value).toBe('developer');
  });

  it('should get valid dynamic facts only', () => {
    mgr.updateProfile('alice', {
      dynamicFact: { statement: 'old task', category: 'current_task' },
    });
    mgr.updateProfile('alice', {
      dynamicFact: { statement: 'new task', category: 'current_task' },
    });

    const valid = mgr.getValidDynamicFacts('alice');
    expect(valid.length).toBe(1);
    expect(valid[0].statement).toBe('new task');
  });

  it('should handle combined static + dynamic update', () => {
    const profile = mgr.updateProfile('alice', {
      static: { role: 'developer', timezone: 'UTC+3' },
      dynamicFact: { statement: 'reviewing PR #42', category: 'current_task' },
    });

    expect(Object.keys(profile.static).length).toBe(2);
    expect(profile.dynamic.length).toBe(1);
  });
});
