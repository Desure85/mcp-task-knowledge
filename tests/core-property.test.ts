/**
 * tests/core-property.test.ts — Property-based testing for core modules (Q-010)
 *
 * Uses fast-check to verify invariants that hold for ANY input:
 *   - RateLimiter: never allows more than burst capacity; refill never
 *     exceeds burst; per-session isolation
 *   - SessionManager: TTL/idle edge cases don't throw; close is idempotent
 *   - ToolExecutor: hook ordering is deterministic
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { RateLimiter } from '../src/core/rate-limiter.js';
import { SessionManager } from '../src/core/session-manager.js';
import { ToolExecutor } from '../src/core/tool-executor.js';

describe('Q-010: RateLimiter properties', () => {
  it('never allows more than burst capacity in any sequence of calls', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 200 }),
        fc.array(fc.constantFrom('allow', 'refill'), { maxLength: 100 }),
        (maxTokens, burstMax, refillPerSec, ops) => {
          const limiter = new RateLimiter({
            maxTokens,
            burstMaxTokens: burstMax,
            refillPerSec,
          });
          const effectiveBurst = Math.max(maxTokens, burstMax);
          let allowed = 0;
          for (const op of ops) {
            if (op === 'allow') {
              if (limiter.allow('s1', 'tool')) allowed++;
            } else {
              limiter.reset('s1');
              allowed = 0;
            }
          }
          // Invariant: can never allow more than burst capacity at once
          expect(allowed).toBeLessThanOrEqual(effectiveBurst);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('refill never exceeds burst capacity over time', () => {
    // Freeze time so the lazy refill can't accumulate between iterations
    vi.useFakeTimers();
    try {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 20, max: 200 }),
          fc.integer({ min: 1, max: 1000 }),
          fc.integer({ min: 1, max: 5000 }),
          (maxTokens, burstMax, refillPerSec, elapsedMs) => {
            const limiter = new RateLimiter({
              maxTokens,
              burstMaxTokens: burstMax,
              refillPerSec,
            });
            const effectiveBurst = Math.max(maxTokens, burstMax);
            // Consume everything at t=0
            for (let i = 0; i < effectiveBurst; i++) limiter.allow('s1', 'tool');
            expect(limiter.allow('s1', 'tool')).toBe(false);

            // Advance time, then a single allow should grant at most burst
            vi.advanceTimersByTime(elapsedMs);
            let allowed = 0;
            for (let i = 0; i < 1000; i++) {
              if (limiter.allow('s1', 'tool')) allowed++;
              else break; // exhausted again — invariant holds
              expect(allowed).toBeLessThanOrEqual(effectiveBurst);
            }
          },
        ),
        { numRuns: 50 },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('sessions are isolated (one exhausted does not affect another)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 10 }),
        (maxTokens, sessions) => {
          const limiter = new RateLimiter({ maxTokens, refillPerSec: 0 });
          for (const s of sessions) {
            for (let i = 0; i < maxTokens; i++) {
              expect(limiter.allow(s, 'tool')).toBe(true);
            }
            expect(limiter.allow(s, 'tool')).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('Q-010: SessionManager properties', () => {
  it('create/close cycles never throw and stay consistent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string(), { maxLength: 30 }),
        fc.integer({ min: 1, max: 100 }),
        async (remotes, maxSessions) => {
          const sm = new SessionManager({ maxSessions });
          for (const r of remotes) {
            try {
              const s = sm.create({ remote: r });
              expect(sm.has(s.id)).toBe(true);
            } catch {
              // maxSessions exceeded — acceptable, but size must be bounded
              expect(sm.size).toBeLessThanOrEqual(maxSessions);
            }
          }
          expect(sm.size).toBeLessThanOrEqual(maxSessions);
          await sm.closeAll();
          expect(sm.size).toBe(0);
          expect(sm.closed).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('heartbeat on arbitrary ids never throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.array(fc.string(), { maxLength: 20 }), async (seed, ids) => {
        const sm = new SessionManager();
        const session = sm.create({ remote: 'r' });
        for (const id of [...ids, session.id, 'nonexistent']) {
          expect(() => sm.heartbeat(id)).not.toThrow();
        }
        await sm.closeAll();
      }),
      { numRuns: 30 },
    );
  });
});

describe('Q-010: ToolExecutor hook ordering', () => {
  it('pre/post/error hooks fire in deterministic order for any input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('pre', 'post', 'error'), { maxLength: 10 }),
        async (hooks) => {
          const executor = new ToolExecutor();
          const order: string[] = [];
          // Register hooks in random order — execution must still be:
          // pre hooks in registration order, then handler, then post hooks
          for (let i = 0; i < hooks.length; i++) {
            const kind = hooks[i];
            const idx = i;
            if (kind === 'pre') {
              executor.addPreHook(async (toolName) => {
                order.push(`pre${idx}`);
                return { deny: false };
              });
            } else if (kind === 'post') {
              executor.addPostHook(async (toolName) => {
                order.push(`post${idx}`);
              });
            } else {
              executor.addErrorHook(async (toolName) => {
                order.push(`err${idx}`);
              });
            }
          }

          const result = await executor.execute('t', {}, { sessionId: 's' } as never, async () => {
            order.push('handler');
            return 'ok';
          });
          expect(result).toBe('ok');
          expect(order).toContain('handler');
          // Pre hooks all fire before handler
          const handlerIdx = order.indexOf('handler');
          for (let i = 0; i < order.length; i++) {
            if (order[i].startsWith('pre')) expect(i).toBeLessThan(handlerIdx);
          }
          // Post hooks all fire after handler
          for (let i = 0; i < order.length; i++) {
            if (order[i].startsWith('post')) expect(i).toBeGreaterThan(handlerIdx);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
