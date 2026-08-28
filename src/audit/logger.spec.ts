/**
 * audit/logger.spec.ts — Tests for AuditLogger (SEC-001).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLogger } from './logger.js';
import { DEFAULT_AUDIT_CONFIG, type AuditConfig, type AuditEvent } from './types.js';

let testDir: string;
let testFile: string;

function createConfig(overrides?: Partial<AuditConfig>): AuditConfig {
  return {
    ...DEFAULT_AUDIT_CONFIG,
    enabled: true,
    filePath: testFile,
    maxFileSize: 500, // small for testing rotation
    maxFiles: 3,
    logInput: true,
    logResult: true,
    ...overrides,
  };
}

describe('SEC-001: AuditLogger', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testFile = join(testDir, 'audit.log');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('constructor', () => {
    it('is no-op when disabled', async () => {
      const logger = new AuditLogger({ ...DEFAULT_AUDIT_CONFIG, enabled: false });
      expect(logger.closed).toBe(false);
      await logger.close();
    });

    it('creates directory and opens stream when enabled', async () => {
      const logger = new AuditLogger(createConfig());
      expect(logger.closed).toBe(false);
      await logger.close();
    });
  });

  describe('log()', () => {
    it('writes JSON lines to file', async () => {
      const logger = new AuditLogger(createConfig());
      logger.record('tool.call', 'success', 'test_tool', {
        sessionId: 'sess-1',
        input: { arg: 'value' },
      });
      await logger.close();

      const content = readFileSync(testFile, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);

      const event = JSON.parse(lines[0]) as AuditEvent;
      expect(event.type).toBe('tool.call');
      expect(event.status).toBe('success');
      expect(event.target).toBe('test_tool');
      expect(event.sessionId).toBe('sess-1');
      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeDefined();
    });

    it('redacts sensitive fields from input', async () => {
      const logger = new AuditLogger(createConfig());
      logger.record('tool.call', 'success', 'auth', {
        input: { username: 'admin', password: 'secret123', token: 'jwt-abc' },
      });
      await logger.close();

      const content = readFileSync(testFile, 'utf8');
      const event = JSON.parse(content.trim()) as AuditEvent;
      expect(event.input).toEqual({
        username: 'admin',
        password: '[REDACTED]',
        token: '[REDACTED]',
      });
    });

    it('does not log input when logInput is false', async () => {
      const logger = new AuditLogger(createConfig({ logInput: false }));
      logger.record('tool.call', 'success', 'test', {
        input: { data: 'value' },
      });
      await logger.close();

      const content = readFileSync(testFile, 'utf8');
      const event = JSON.parse(content.trim()) as AuditEvent;
      expect(event.input).toBeUndefined();
    });

    it('does not log result when logResult is false', async () => {
      const logger = new AuditLogger(createConfig({ logResult: false }));
      logger.record('tool.result', 'success', 'test', {
        result: { data: 'value' },
      });
      await logger.close();

      const content = readFileSync(testFile, 'utf8');
      const event = JSON.parse(content.trim()) as AuditEvent;
      expect(event.result).toBeUndefined();
    });

    it('truncates long results', async () => {
      const logger = new AuditLogger(createConfig({ maxResultLength: 50 }));
      const longResult = 'x'.repeat(200);
      logger.record('tool.result', 'success', 'test', { result: longResult });
      await logger.close();

      const content = readFileSync(testFile, 'utf8');
      const event = JSON.parse(content.trim()) as AuditEvent;
      expect(String(event.result)).toContain('...[truncated]');
    });
  });

  describe('rotation', () => {
    it('rotates when file exceeds maxFileSize', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 200, maxFiles: 3 }));
      for (let i = 0; i < 10; i++) {
        logger.record('tool.call', 'success', `tool_${i}`, {
          input: { data: 'x'.repeat(50) },
        });
      }
      await logger.close();

      expect(existsSync(`${testFile}.1`)).toBe(true);
    });

    it('keeps only maxFiles rotated files', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 100, maxFiles: 2 }));
      for (let i = 0; i < 30; i++) {
        logger.record('tool.call', 'success', `tool_${i}`, {
          input: { data: 'x'.repeat(50) },
        });
      }
      await logger.close();

      expect(existsSync(`${testFile}.1`)).toBe(true);
      expect(existsSync(`${testFile}.2`)).toBe(true);
      expect(existsSync(`${testFile}.3`)).toBe(false);
    });
  });

  describe('query()', () => {
    it('returns events matching filters', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 0 }));
      logger.record('tool.call', 'success', 'tool_a', { sessionId: 's1' });
      logger.record('tool.call', 'error', 'tool_b', { sessionId: 's2' });
      logger.record('tool.result', 'success', 'tool_a', { sessionId: 's1' });
      await logger.close();

      const result = logger.query({ type: 'tool.call' });
      expect(result.events.length).toBe(2);
      expect(result.events.every((e) => e.type === 'tool.call')).toBe(true);
    });

    it('filters by status', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 0 }));
      logger.record('tool.call', 'success', 'tool_a');
      logger.record('tool.call', 'error', 'tool_b');
      await logger.close();

      const result = logger.query({ status: 'error' });
      expect(result.events.length).toBe(1);
      expect(result.events[0].status).toBe('error');
    });

    it('filters by target', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 0 }));
      logger.record('tool.call', 'success', 'tool_a');
      logger.record('tool.call', 'success', 'tool_b');
      await logger.close();

      const result = logger.query({ target: 'tool_a' });
      expect(result.events.length).toBe(1);
      expect(result.events[0].target).toBe('tool_a');
    });

    it('filters by sessionId', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 0 }));
      logger.record('tool.call', 'success', 'tool_a', { sessionId: 's1' });
      logger.record('tool.call', 'success', 'tool_b', { sessionId: 's2' });
      await logger.close();

      const result = logger.query({ sessionId: 's1' });
      expect(result.events.length).toBe(1);
      expect(result.events[0].sessionId).toBe('s1');
    });

    it('paginates with limit and offset', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 0 }));
      for (let i = 0; i < 10; i++) {
        logger.record('tool.call', 'success', `tool_${i}`);
      }
      await logger.close();

      const page1 = logger.query({ limit: 3, offset: 0 });
      const page2 = logger.query({ limit: 3, offset: 3 });
      expect(page1.events.length).toBe(3);
      expect(page2.events.length).toBe(3);
      expect(page1.total).toBe(10);
      expect(page1.events[0].id).not.toBe(page2.events[0].id);
    });

    it('sorts by timestamp descending (newest first)', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 0 }));
      logger.record('tool.call', 'success', 'first');
      logger.record('tool.call', 'success', 'second');
      await logger.close();

      const result = logger.query({});
      expect(result.events.length).toBe(2);
      expect(result.events[0].target).toBe('second');
      expect(result.events[1].target).toBe('first');
    });
  });

  describe('export()', () => {
    it('returns all events as array', async () => {
      const logger = new AuditLogger(createConfig({ maxFileSize: 0 }));
      logger.record('tool.call', 'success', 'tool_a');
      logger.record('tool.call', 'success', 'tool_b');
      await logger.close();

      const events = logger.export();
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(2);
    });
  });

  describe('createEvent()', () => {
    it('auto-generates id and timestamp', async () => {
      const logger = new AuditLogger(createConfig());
      const event = logger.createEvent({
        type: 'tool.call',
        status: 'success',
        target: 'test',
      });
      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.type).toBe('tool.call');
      await logger.close();
    });
  });

  describe('close()', () => {
    it('is idempotent', async () => {
      const logger = new AuditLogger(createConfig());
      await logger.close();
      // Second close should resolve without error
      await expect(logger.close()).resolves.toBeUndefined();
    });
  });
});

describe('SEC-001: DEFAULT_AUDIT_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_AUDIT_CONFIG.enabled).toBe(false);
    expect(DEFAULT_AUDIT_CONFIG.maxFileSize).toBe(10 * 1024 * 1024);
    expect(DEFAULT_AUDIT_CONFIG.maxFiles).toBe(5);
    expect(DEFAULT_AUDIT_CONFIG.logInput).toBe(true);
    expect(DEFAULT_AUDIT_CONFIG.logResult).toBe(false);
    expect(DEFAULT_AUDIT_CONFIG.redactFields).toContain('password');
    expect(DEFAULT_AUDIT_CONFIG.redactFields).toContain('token');
  });
});
