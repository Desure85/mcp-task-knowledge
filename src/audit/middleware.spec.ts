/**
 * audit/middleware.spec.ts — Tests for AuditMiddleware (SEC-001).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AuditMiddleware } from './middleware.js';
import { AuditLogger } from './logger.js';
import { DEFAULT_AUDIT_CONFIG, type AuditConfig } from './types.js';
import { MiddlewareContext } from '../core/middleware.js';
import type { ToolContext } from '../core/tool-executor.js';

let testDir: string;
let testFile: string;

function createConfig(overrides?: Partial<AuditConfig>): AuditConfig {
  return {
    ...DEFAULT_AUDIT_CONFIG,
    enabled: true,
    filePath: testFile,
    maxFileSize: 0,
    logInput: true,
    logResult: true,
    ...overrides,
  };
}

function createMockContext(toolName: string, input: Record<string, unknown> = {}): MiddlewareContext {
  return new MiddlewareContext(toolName, input, {
    sessionId: 'test-session',
    userId: 'test-user',
  } as ToolContext);
}

describe('SEC-001: AuditMiddleware', () => {
  let logger: AuditLogger;
  let middleware: AuditMiddleware;

  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `audit-mw-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testFile = join(testDir, 'audit.log');
    mkdirSync(testDir, { recursive: true });
    logger = new AuditLogger(createConfig());
    middleware = new AuditMiddleware(logger);
  });

  afterEach(async () => {
    await logger.close();
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('has name "audit"', () => {
    expect(middleware.name).toBe('audit');
  });

  it('records pending event in before()', async () => {
    const ctx = createMockContext('test_tool', { arg: 'value' });
    await middleware.before?.(ctx);
    await logger.close();

    const events = logger.export();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('tool.call');
    expect(events[0].status).toBe('pending');
    expect(events[0].target).toBe('test_tool');
    expect(events[0].sessionId).toBe('test-session');
    expect(events[0].userId).toBe('test-user');
  });

  it('records success event in after()', async () => {
    const ctx = createMockContext('test_tool');
    ctx.durationMs = 42;
    const result = await middleware.after?.(ctx, { data: 'ok' });

    expect(result).toEqual({ data: 'ok' });
    await logger.close();

    const events = logger.export();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('tool.result');
    expect(events[0].status).toBe('success');
    expect(events[0].durationMs).toBe(42);
  });

  it('records denied status when short-circuited in after()', async () => {
    const ctx = createMockContext('denied_tool');
    ctx.shortCircuit({ error: 'forbidden' });
    ctx.durationMs = 5;

    await middleware.after?.(ctx, { error: 'forbidden' });
    await logger.close();

    const events = logger.export();
    expect(events[0].status).toBe('denied');
  });

  it('records error event in onError() and re-throws', async () => {
    const ctx = createMockContext('failing_tool');
    ctx.durationMs = 10;
    const testError = new Error('something went wrong');

    await expect(middleware.onError?.(ctx, testError)).rejects.toThrow('something went wrong');
    await logger.close();

    const events = logger.export();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('tool.error');
    expect(events[0].status).toBe('error');
    expect(events[0].error).toBe('something went wrong');
  });

  it('records error with stringified non-Error in onError()', async () => {
    const ctx = createMockContext('failing_tool');
    ctx.durationMs = 5;

    await expect(middleware.onError?.(ctx, 'string error')).rejects.toThrow('string error');
    await logger.close();

    const events = logger.export();
    expect(events[0].error).toBe('string error');
  });

  it('records before + after for a full tool call lifecycle', async () => {
    const ctx = createMockContext('lifecycle_tool', { x: 1 });
    await middleware.before?.(ctx);
    ctx.durationMs = 100;
    await middleware.after?.(ctx, { result: 'done' });
    await logger.close();

    const events = logger.export();
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('tool.result');
    expect(events[1].type).toBe('tool.call');
  });

  it('records before + error for a failed tool call lifecycle', async () => {
    const ctx = createMockContext('lifecycle_fail', { x: 1 });
    await middleware.before?.(ctx);
    ctx.durationMs = 50;
    try {
      await middleware.onError?.(ctx, new Error('boom'));
    } catch { /* expected */ }
    await logger.close();

    const events = logger.export();
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('tool.error');
    expect(events[1].type).toBe('tool.call');
  });
});
