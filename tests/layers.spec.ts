/**
 * tests/layers.spec.ts — Unit tests for Memory Layers (NEXT-017).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LayeredMemory } from '../src/memory/layers.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_FILE = join(tmpdir(), `test-layers-${Date.now()}.json`);

describe('LayeredMemory', () => {
  let mem: LayeredMemory;

  beforeEach(() => {
    mem = new LayeredMemory({ storagePath: TEST_FILE });
  });

  afterEach(async () => {
    try { await fsp.unlink(TEST_FILE); } catch { /* ignore */ }
  });

  it('should add fact to conversation layer', () => {
    const fact = mem.add('conversation', { statement: 'user asked about auth' });
    expect(fact.layer).toBe('conversation');
    expect(fact.valid).toBe(true);
  });

  it('should get facts from specific layer', () => {
    mem.add('conversation', { statement: 'fact A' });
    mem.add('session', { statement: 'fact B' });
    mem.add('user', { statement: 'fact C' });

    expect(mem.getLayer('conversation').length).toBe(1);
    expect(mem.getLayer('session').length).toBe(1);
    expect(mem.getLayer('user').length).toBe(1);
  });

  it('should promote single fact between layers', () => {
    const fact = mem.add('conversation', { statement: 'promote me' });
    const success = mem.promote('conversation', 'session', fact.id);
    expect(success).toBe(true);
    expect(mem.getLayer('conversation').length).toBe(0);
    expect(mem.getLayer('session').length).toBe(1);
  });

  it('should promote all facts between layers', () => {
    mem.add('conversation', { statement: 'fact 1' });
    mem.add('conversation', { statement: 'fact 2' });
    mem.add('conversation', { statement: 'fact 3' });

    const count = mem.promoteAll('conversation', 'session');
    expect(count).toBe(3);
    expect(mem.getLayer('conversation').length).toBe(0);
    expect(mem.getLayer('session').length).toBe(3);
  });

  it('should invalidate fact in layer', () => {
    const fact = mem.add('session', { statement: 'temp fact' });
    mem.invalidate('session', fact.id);
    expect(mem.getLayer('session').length).toBe(0);
  });

  it('should clear layer', () => {
    mem.add('conversation', { statement: 'a' });
    mem.add('conversation', { statement: 'b' });
    const count = mem.clearLayer('conversation');
    expect(count).toBe(2);
    expect(mem.getLayer('conversation').length).toBe(0);
  });

  it('should return stats', () => {
    mem.add('conversation', { statement: 'a' });
    mem.add('session', { statement: 'b' });
    mem.add('user', { statement: 'c' });
    const stats = mem.stats();
    expect(stats.conversation.valid).toBe(1);
    expect(stats.session.valid).toBe(1);
    expect(stats.user.valid).toBe(1);
  });

  it('should persist and reload', () => {
    mem.add('user', { statement: 'persistent fact' });
    const mem2 = new LayeredMemory({ storagePath: TEST_FILE });
    expect(mem2.getLayer('user').length).toBe(1);
  });

  it('should return false for promoting non-existent fact', () => {
    expect(mem.promote('conversation', 'session', 'nonexistent')).toBe(false);
  });

  it('should return null for non-existent fact', () => {
    expect(mem.get('conversation', 'nonexistent')).toBeNull();
  });
});
