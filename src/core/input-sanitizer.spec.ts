/**
 * core/input-sanitizer.spec.ts — Tests for input sanitization (SEC-006).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  sanitizeString,
  detectThreats,
  sanitizeValue,
  InputSanitizerMiddleware,
  DEFAULT_SANITIZER_CONFIG,
} from './input-sanitizer.js';
import { MiddlewareContext } from './middleware.js';
import type { ToolContext } from './tool-executor.js';

function createCtx(input: Record<string, unknown>): MiddlewareContext {
  return new MiddlewareContext('test_tool', input, { sessionId: 's1' } as ToolContext);
}

describe('SEC-006: sanitizeString', () => {
  it('removes script tags', () => {
    expect(sanitizeString('<script>alert(1)</script>')).not.toContain('<script>');
    expect(sanitizeString('<script>alert(1)</script>')).not.toContain('</script>');
  });

  it('escapes HTML entities', () => {
    const result = sanitizeString('<div>hello</div>');
    expect(result).toContain('&lt;div&gt;');
    expect(result).not.toContain('<div>');
  });

  it('removes javascript: protocol', () => {
    expect(sanitizeString('javascript:alert(1)')).not.toContain('javascript:');
  });

  it('removes event handlers', () => {
    const result = sanitizeString('<img onclick="alert(1)">');
    expect(result).not.toContain('onclick=');
  });

  it('removes path traversal', () => {
    expect(sanitizeString('../../etc/passwd')).not.toContain('../');
    expect(sanitizeString('..\\windows\\system32')).not.toContain('..\\');
  });

  it('removes command injection metacharacters', () => {
    expect(sanitizeString('$(whoami)')).not.toContain('$(');
    expect(sanitizeString('`id`')).not.toContain('`');
  });

  it('removes SQL comment markers', () => {
    expect(sanitizeString('SELECT 1 -- comment')).not.toContain('--');
    expect(sanitizeString('/* block */')).not.toContain('/*');
  });

  it('leaves safe strings mostly intact', () => {
    expect(sanitizeString('hello world')).toBe('hello world');
    expect(sanitizeString('user@example.com')).toBe('user@example.com');
  });
});

describe('SEC-006: detectThreats', () => {
  it('detects SQL injection', () => {
    expect(detectThreats('1 OR 1=1')?.type).toBe('sql_injection');
    expect(detectThreats("1 OR 'a'='a'")?.type).toBe('sql_injection');
    expect(detectThreats('SELECT * FROM users')?.type).toBe('sql_injection');
  });

  it('detects XSS', () => {
    expect(detectThreats('<script>alert(1)')?.type).toBe('xss');
    expect(detectThreats('<img onclick="alert(1)">')?.type).toBe('xss');
    expect(detectThreats('javascript:alert(1)')?.type).toBe('xss');
  });

  it('detects path traversal', () => {
    expect(detectThreats('../../../etc/passwd')?.type).toBe('path_traversal');
    expect(detectThreats('..\\windows\\system32')?.type).toBe('path_traversal');
  });

  it('detects command injection', () => {
    expect(detectThreats('$(whoami)')?.type).toBe('command_injection');
    expect(detectThreats('`id`')?.type).toBe('command_injection');
  });

  it('detects custom patterns', () => {
    const customPattern = /FORBIDDEN_WORD/;
    expect(detectThreats('hello FORBIDDEN_WORD world', [customPattern])?.type).toBe('custom');
  });

  it('returns null for safe strings', () => {
    expect(detectThreats('hello world')).toBeNull();
    expect(detectThreats('user@example.com')).toBeNull();
    expect(detectThreats('123')).toBeNull();
  });
});

describe('SEC-006: sanitizeValue', () => {
  const config = { ...DEFAULT_SANITIZER_CONFIG };

  it('passes through null and undefined', () => {
    expect(sanitizeValue(null, config).value).toBeNull();
    expect(sanitizeValue(undefined, config).value).toBeUndefined();
  });

  it('passes through numbers and booleans', () => {
    expect(sanitizeValue(42, config).value).toBe(42);
    expect(sanitizeValue(true, config).value).toBe(true);
  });

  it('sanitizes strings with XSS', () => {
    const result = sanitizeValue('<script>alert(1)</script>', config);
    expect(result.detected).toBe(true);
    expect(result.threatType).toBe('xss');
    expect(result.value).not.toContain('<script>');
  });

  it('sanitizes nested objects', () => {
    const result = sanitizeValue({ name: '<script>x</script>', age: 30 }, config);
    expect(result.detected).toBe(true);
    const value = result.value as Record<string, unknown>;
    expect(value.name).not.toContain('<script>');
    expect(value.age).toBe(30);
  });

  it('sanitizes arrays', () => {
    const result = sanitizeValue(['<script>x</script>', 'safe'], config);
    expect(result.detected).toBe(true);
    const value = result.value as unknown[];
    expect(value[0]).not.toContain('<script>');
    expect(value[1]).toBe('safe');
  });

  it('detects deeply nested threats', () => {
    const result = sanitizeValue({ user: { bio: '<script>alert(1)</script>' } }, config);
    expect(result.detected).toBe(true);
    expect(result.path).toBe('user.bio');
  });

  it('rejects in reject mode', () => {
    const rejectConfig = { ...config, mode: 'reject' as const };
    const result = sanitizeValue('<script>alert(1)</script>', rejectConfig);
    expect(result.detected).toBe(true);
    expect(result.threatType).toBe('xss');
    expect(result.description).toContain('xss');
  });

  it('enforces maxStringLength', () => {
    const sizeConfig = { ...config, maxStringLength: 5 };
    const result = sanitizeValue('hello world', sizeConfig);
    expect(result.detected).toBe(true);
    expect(result.threatType).toBe('size_limit');
  });

  it('enforces maxDepth', () => {
    const depthConfig = { ...config, maxDepth: 2 };
    const deep = { a: { b: { c: 'safe' } } };
    const result = sanitizeValue(deep, depthConfig);
    expect(result.detected).toBe(true);
    expect(result.threatType).toBe('size_limit');
  });

  it('enforces maxKeys', () => {
    const keyConfig = { ...config, maxKeys: 2 };
    const result = sanitizeValue({ a: 1, b: 2, c: 3 }, keyConfig);
    expect(result.detected).toBe(true);
    expect(result.threatType).toBe('size_limit');
  });

  it('enforces maxArrayLength', () => {
    const arrConfig = { ...config, maxArrayLength: 2 };
    const result = sanitizeValue([1, 2, 3], arrConfig);
    expect(result.detected).toBe(true);
    expect(result.threatType).toBe('size_limit');
  });

  it('skips allowlisted fields', () => {
    const skipConfig = { ...config, skipFields: ['html_content'] };
    const result = sanitizeValue({ html_content: '<script>alert(1)</script>', name: 'safe' }, skipConfig);
    // html_content is skipped, so no threat detected from it
    // but name is safe so no detection
    expect(result.detected).toBe(false);
    const value = result.value as Record<string, unknown>;
    expect(value.html_content).toBe('<script>alert(1)</script>');
  });
});

describe('SEC-006: InputSanitizerMiddleware', () => {
  it('has name "input-sanitizer"', () => {
    const mw = new InputSanitizerMiddleware();
    expect(mw.name).toBe('input-sanitizer');
  });

  it('sanitizes input in sanitize mode', async () => {
    const mw = new InputSanitizerMiddleware({ mode: 'sanitize' });
    const ctx = createCtx({ query: '<script>alert(1)</script>' });
    await mw.before?.(ctx);

    expect(ctx.input.query).not.toContain('<script>');
  });

  it('short-circuits in reject mode', async () => {
    const mw = new InputSanitizerMiddleware({ mode: 'reject' });
    const ctx = createCtx({ query: '<script>alert(1)</script>' });
    const result = await mw.before?.(ctx);

    expect(ctx.shortCircuited).toBe(true);
    expect(result?.shortCircuit).toBeDefined();
  });

  it('passes through safe input', async () => {
    const mw = new InputSanitizerMiddleware();
    const ctx = createCtx({ name: 'hello', age: 30 });
    await mw.before?.(ctx);

    expect(ctx.input.name).toBe('hello');
    expect(ctx.input.age).toBe(30);
    expect(ctx.shortCircuited).toBe(false);
  });

  it('sanitizes nested input', async () => {
    const mw = new InputSanitizerMiddleware();
    const ctx = createCtx({ user: { bio: '<script>x</script>' } });
    await mw.before?.(ctx);

    const user = ctx.input.user as Record<string, unknown>;
    expect(user.bio).not.toContain('<script>');
  });

  it('detects SQL injection in input', async () => {
    const mw = new InputSanitizerMiddleware({ mode: 'reject' });
    const ctx = createCtx({ query: "1 OR 'a'='a'" });
    await mw.before?.(ctx);

    expect(ctx.shortCircuited).toBe(true);
  });

  it('detects path traversal in input', async () => {
    const mw = new InputSanitizerMiddleware({ mode: 'reject' });
    const ctx = createCtx({ path: '../../../etc/passwd' });
    await mw.before?.(ctx);

    expect(ctx.shortCircuited).toBe(true);
  });

  it('uses custom patterns', async () => {
    const mw = new InputSanitizerMiddleware({
      mode: 'reject',
      customPatterns: [/FORBIDDEN/],
    });
    const ctx = createCtx({ text: 'hello FORBIDDEN world' });
    await mw.before?.(ctx);

    expect(ctx.shortCircuited).toBe(true);
  });

  it('respects skipFields', async () => {
    const mw = new InputSanitizerMiddleware({
      mode: 'reject',
      skipFields: ['raw_html'],
    });
    const ctx = createCtx({ raw_html: '<script>alert(1)</script>', name: 'safe' });
    await mw.before?.(ctx);

    expect(ctx.shortCircuited).toBe(false);
    expect(ctx.input.raw_html).toBe('<script>alert(1)</script>');
  });
});

describe('SEC-006: DEFAULT_SANITIZER_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_SANITIZER_CONFIG.mode).toBe('sanitize');
    expect(DEFAULT_SANITIZER_CONFIG.maxDepth).toBe(10);
    expect(DEFAULT_SANITIZER_CONFIG.maxKeys).toBe(100);
    expect(DEFAULT_SANITIZER_CONFIG.maxArrayLength).toBe(1000);
  });
});
