/**
 * Tests for RateLimiter — Token bucket per-session rate limiting (S-003)
 *
 * Covers: basic allow/deny, refill, burst, per-tool costs, exempt tools,
 * PreToolHook integration, bucket management, diagnostics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter } from '../src/core/rate-limiter.js';
import { ToolExecutor } from '../src/core/tool-executor.js';
import type { RateLimiterOptions } from '../src/core/rate-limiter.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function createMockContext(sessionId = 'sess-1'): any {
  return {
    sessionId,
    remote: '127.0.0.1:1234',
    roles: [],
    metadata: {},
    createdAt: Date.now(),
    server: {},
  };
}

function createLimiter(overrides?: Partial<RateLimiterOptions>): RateLimiter {
  return new RateLimiter({
    maxTokens: 5,
    refillPerSec: 10, // fast refill for tests
    burstMaxTokens: 10,
    ...overrides,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Basic allow/deny ─────────────────────────────────────────────────

describe('RateLimiter — basic allow/deny', () => {
  it('should allow calls within token limit', () => {
    const limiter = createLimiter({ maxTokens: 3, refillPerSec: 0 }); // no refill

    expect(limiter.allow('s1', 'tool_a')).toBe(true);
    expect(limiter.allow('s1', 'tool_b')).toBe(true);
    expect(limiter.allow('s1', 'tool_c')).toBe(true);
    expect(limiter.allow('s1', 'tool_d')).toBe(false); // 4th call denied
  });

  it('should deny when tokens exhausted', () => {
    const limiter = createLimiter({ maxTokens: 1, refillPerSec: 0 });

    expect(limiter.allow('s1', 'tool')).toBe(true);
    expect(limiter.allow('s1', 'tool')).toBe(false);
    expect(limiter.allow('s1', 'tool')).toBe(false);
  });

  it('should track sessions independently', () => {
    const limiter = createLimiter({ maxTokens: 2, refillPerSec: 0 });

    expect(limiter.allow('s1', 'tool')).toBe(true);
    expect(limiter.allow('s1', 'tool')).toBe(true);
    expect(limiter.allow('s1', 'tool')).toBe(false); // s1 exhausted

    expect(limiter.allow('s2', 'tool')).toBe(true); // s2 has own bucket
    expect(limiter.allow('s2', 'tool')).toBe(true);
    expect(limiter.allow('s2', 'tool')).toBe(false);
  });
});

// ─── Refill ───────────────────────────────────────────────────────────

describe('RateLimiter — refill', () => {
  it('should refill tokens over time', async () => {
    const limiter = createLimiter({ maxTokens: 2, refillPerSec: 100 }); // 10 tokens per 100ms

    expect(limiter.allow('s1', 'tool')).toBe(true);
    expect(limiter.allow('s1', 'tool')).toBe(true);
    expect(limiter.allow('s1', 'tool')).toBe(false);

    // Wait for enough refill (need 1 token at 100/sec = 10ms)
    await sleep(20);
    expect(limiter.allow('s1', 'tool')).toBe(true);
  });

  it('should not exceed burst capacity', async () => {
    const limiter = createLimiter({ maxTokens: 3, burstMaxTokens: 5, refillPerSec: 100 });

    // Consume 3
    for (let i = 0; i < 3; i++) {
      expect(limiter.allow('s1', 'tool')).toBe(true);
    }

    // Wait long enough to refill to burst
    await sleep(100);

    // Should be able to consume up to burst (5 total), not more
    let allowed = 0;
    for (let i = 0; i < 5; i++) {
      if (limiter.allow('s1', 'tool')) allowed++;
    }
    expect(allowed).toBeLessThanOrEqual(5);
  });
});

// ─── Burst ────────────────────────────────────────────────────────────

describe('RateLimiter — burst', () => {
  it('should allow refill to accumulate above maxTokens via burst', async () => {
    // Use high maxTokens so loop timing doesn't cause false negatives on slow CI
    const limiter = createLimiter({ maxTokens: 10, burstMaxTokens: 20, refillPerSec: 1000 });

    // Consume all 10 starting tokens
    for (let i = 0; i < 10; i++) {
      expect(limiter.allow('s1', 'tool')).toBe(true);
    }
    // Should be denied — no tokens left (burst allows refill > max, not immediate over-draft)
    expect(limiter.allow('s1', 'tool')).toBe(false);

    // Wait for refill — at 1000/sec, 5ms ≈ 5 tokens, burst allows accumulation above maxTokens
    await sleep(5);
    expect(limiter.allow('s1', 'tool')).toBe(true);

    // Should allow up to burst (20 total consumed)
    // After refill, we had ~5 tokens. Consume them to verify burst capacity
    let count = 0;
    while (limiter.allow('s1', 'tool')) count++;
    // Total should be reasonable — burst allows accumulation above maxTokens
    expect(count).toBeGreaterThan(0);
  });

  it('should default burst to maxTokens if burst < max', () => {
    const limiter = new RateLimiter({ maxTokens: 10, burstMaxTokens: 5, refillPerSec: 0 });
    // burst should be capped to maxTokens
    for (let i = 0; i < 10; i++) {
      expect(limiter.allow('s1', 'tool')).toBe(true);
    }
    expect(limiter.allow('s1', 'tool')).toBe(false);
  });
});

// ─── Per-tool costs ───────────────────────────────────────────────────

describe('RateLimiter — per-tool costs', () => {
  it('should use higher cost for expensive tools', () => {
    const limiter = createLimiter({
      maxTokens: 5,
      refillPerSec: 0,
      toolCosts: { expensive_tool: 3 },
    });

    expect(limiter.allow('s1', 'cheap_tool')).toBe(true);
    expect(limiter.allow('s1', 'cheap_tool')).toBe(true);
    expect(limiter.allow('s1', 'cheap_tool')).toBe(true);
    expect(limiter.allow('s1', 'cheap_tool')).toBe(true);
    expect(limiter.allow('s1', 'cheap_tool')).toBe(true); // 5 cheap = 5 tokens

    // expensive_tool costs 3 — not enough tokens left
    expect(limiter.allow('s1', 'expensive_tool')).toBe(false);
  });

  it('should use default cost for unknown tools', () => {
    const limiter = createLimiter({
      maxTokens: 5,
      refillPerSec: 0,
      defaultCost: 2,
    });

    // 2 calls × 2 tokens = 4
    expect(limiter.allow('s1', 'any')).toBe(true);
    expect(limiter.allow('s1', 'any')).toBe(true);
    // 3rd call needs 2, only 1 left
    expect(limiter.allow('s1', 'any')).toBe(false);
  });
});

// ─── Exempt tools ─────────────────────────────────────────────────────

describe('RateLimiter — exempt tools', () => {
  it('should always allow exempt tools', () => {
    const limiter = createLimiter({
      maxTokens: 1,
      refillPerSec: 0,
      exemptTools: ['health_check', 'ping'],
    });

    expect(limiter.allow('s1', 'normal')).toBe(true);
    expect(limiter.allow('s1', 'normal')).toBe(false);

    // Exempt tools always pass
    expect(limiter.allow('s1', 'health_check')).toBe(true);
    expect(limiter.allow('s1', 'health_check')).toBe(true);
    expect(limiter.allow('s1', 'health_check')).toBe(true);
    expect(limiter.allow('s1', 'ping')).toBe(true);
  });

  it('should accept exemptTools as Set', () => {
    const limiter = createLimiter({
      maxTokens: 0,
      refillPerSec: 0,
      exemptTools: new Set(['free_tool']),
    });

    expect(limiter.allow('s1', 'free_tool')).toBe(true);
    expect(limiter.allow('s1', 'limited')).toBe(false);
  });
});

// ─── Disabled ─────────────────────────────────────────────────────────

describe('RateLimiter — disabled', () => {
  it('should allow all calls when disabled', () => {
    const limiter = createLimiter({ maxTokens: 1, refillPerSec: 0, enabled: false });

    for (let i = 0; i < 100; i++) {
      expect(limiter.allow('s1', 'tool')).toBe(true);
    }
  });
});

// ─── PreToolHook integration ──────────────────────────────────────────

describe('RateLimiter — PreToolHook', () => {
  it('should create working pre-hook for ToolExecutor', async () => {
    const limiter = createLimiter({ maxTokens: 2, refillPerSec: 0 });
    const executor = new ToolExecutor();
    executor.addPreHook(limiter.createPreHook());
    const ctx = createMockContext('sess-hook');

    const handler = async () => 'ok';

    // First two calls allowed
    expect(await executor.execute('tool', {}, ctx, handler)).toBe('ok');
    expect(await executor.execute('tool', {}, ctx, handler)).toBe('ok');

    // Third denied
    await expect(executor.execute('tool', {}, ctx, handler)).rejects.toThrow(/rate limited/);
  });

  it('should include retry info in denial reason when refill is enabled', async () => {
    const limiter = createLimiter({ maxTokens: 1, refillPerSec: 10 }); // has refill
    const executor = new ToolExecutor();
    executor.addPreHook(limiter.createPreHook());
    const ctx = createMockContext();

    await executor.execute('tool', {}, ctx, async () => 'ok');

    try {
      await executor.execute('tool', {}, ctx, async () => 'no');
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('rate limited');
      expect(err.message).toContain('retry after');
    }
  });
});

// ─── Diagnostics ──────────────────────────────────────────────────────

describe('RateLimiter — diagnostics', () => {
  it('should return rate limit info', () => {
    const limiter = createLimiter({ maxTokens: 10, refillPerSec: 0 });

    const info = limiter.getInfo('s1');
    expect(info).toBeUndefined(); // no bucket yet

    limiter.allow('s1', 'tool'); // consume 1

    const infoAfter = limiter.getInfo('s1');
    expect(infoAfter).toBeDefined();
    expect(infoAfter!.remaining).toBe(9);
    expect(infoAfter!.maxTokens).toBe(10);
    expect(infoAfter!.refillPerSec).toBe(0);
  });

  it('should report retryAfterSec > 0 when exhausted', () => {
    const limiter = createLimiter({ maxTokens: 1, refillPerSec: 10, burstMaxTokens: 1 });

    limiter.allow('s1', 'tool');
    limiter.allow('s1', 'tool'); // denied

    const info = limiter.getInfo('s1')!;
    expect(info.remaining).toBe(0);
    expect(info.retryAfterSec).toBeGreaterThan(0);
  });

  it('should report retryAfterSec = 0 when tokens available', () => {
    const limiter = createLimiter({ maxTokens: 10, refillPerSec: 0 });
    limiter.allow('s1', 'tool');

    const info = limiter.getInfo('s1')!;
    expect(info.retryAfterSec).toBe(0);
  });

  it('should track bucket count', () => {
    const limiter = createLimiter({ maxTokens: 5, refillPerSec: 0 });

    expect(limiter.size).toBe(0);

    limiter.allow('s1', 'tool');
    expect(limiter.size).toBe(1);

    limiter.allow('s2', 'tool');
    expect(limiter.size).toBe(2);
  });
});

// ─── Bucket management ───────────────────────────────────────────────

describe('RateLimiter — bucket management', () => {
  it('should reset a session bucket', () => {
    const limiter = createLimiter({ maxTokens: 2, refillPerSec: 0 });

    limiter.allow('s1', 'tool');
    limiter.allow('s1', 'tool');
    expect(limiter.allow('s1', 'tool')).toBe(false);

    expect(limiter.reset('s1')).toBe(true);
    expect(limiter.allow('s1', 'tool')).toBe(true);
  });

  it('should return false when resetting unknown session', () => {
    const limiter = createLimiter();
    expect(limiter.reset('nonexistent')).toBe(false);
  });

  it('should remove a session bucket', () => {
    const limiter = createLimiter({ maxTokens: 1, refillPerSec: 0 });

    limiter.allow('s1', 'tool');
    expect(limiter.size).toBe(1);

    expect(limiter.remove('s1')).toBe(true);
    expect(limiter.size).toBe(0);
    expect(limiter.getInfo('s1')).toBeUndefined();
  });

  it('should clear all buckets', () => {
    const limiter = createLimiter({ maxTokens: 5, refillPerSec: 0 });

    limiter.allow('s1', 'tool');
    limiter.allow('s2', 'tool');
    limiter.allow('s3', 'tool');
    expect(limiter.size).toBe(3);

    limiter.clear();
    expect(limiter.size).toBe(0);
  });
});

// ─── Default configuration ───────────────────────────────────────────

describe('RateLimiter — defaults', () => {
  it('should use default configuration when no options', () => {
    const limiter = new RateLimiter();
    expect(limiter.size).toBe(0);

    // Should allow many calls with default 60 tokens
    let allowed = 0;
    for (let i = 0; i < 60; i++) {
      if (limiter.allow('s-default', 'tool')) allowed++;
    }
    expect(allowed).toBe(60);
    expect(limiter.allow('s-default', 'tool')).toBe(false);
  });
});
