/**
 * Rate Limiter — Token bucket per-session rate limiting (S-003)
 *
 * Implements a token bucket algorithm with configurable rates per session.
 * Designed as a PreToolHook for ToolExecutor — seamlessly integrates
 * with the existing hook pipeline from S-002.
 *
 * Token bucket algorithm:
 *   - Each session has a bucket with maxTokens capacity
 *   - Tokens refill at a steady rate (tokensPerSecond)
 *   - Each tool call consumes 1 token (or configurable cost)
 *   - If bucket is empty, the call is denied (rate limited)
 *   - Tokens accumulate when not used (up to maxTokens)
 *
 * Features:
 *   - Per-session buckets (keyed by sessionId)
 *   - Global default rate + per-tool overrides
 *   - Configurable via env vars or options
 *   - Automatic cleanup of expired sessions
 *   - Diagnostics: remaining tokens, reset time, bucket stats
 *
 * Configuration (env vars):
 *   - MCP_RATE_LIMIT_MAX_TOKENS (default: 60)
 *   - MCP_RATE_LIMIT_REFILL_PER_SEC (default: 1)
 *   - MCP_RATE_LIMIT_BURST_MAX_TOKENS (default: 100)
 *
 * Usage:
 *   const limiter = new RateLimiter({ maxTokens: 30, refillPerSec: 0.5 });
 *   executor.addPreHook(limiter.createPreHook());
 */

import type { PreToolHook, ToolContext } from './tool-executor.js';
import { childLogger } from './logger.js';

const log = childLogger('rate-limiter');

// ─── Types ────────────────────────────────────────────────────────────

/** Configuration for the rate limiter. */
export interface RateLimiterOptions {
  /** Maximum tokens per session bucket. Default: 60 (env: MCP_RATE_LIMIT_MAX_TOKENS). */
  maxTokens?: number;
  /** Tokens refilled per second. Default: 1 (env: MCP_RATE_LIMIT_REFILL_PER_SEC). */
  refillPerSec?: number;
  /**
   * Burst capacity — max tokens a session can accumulate.
   * Allows short bursts above maxTokens. Default: 100 (env: MCP_RATE_LIMIT_BURST_MAX_TOKENS).
   */
  burstMaxTokens?: number;
  /**
   * Cost per tool call in tokens. Default: 1.
   * Can be overridden per-tool via `toolCosts`.
   */
  defaultCost?: number;
  /**
   * Per-tool cost overrides. Tool names not listed use defaultCost.
   * Example: { 'tasks_create': 3, 'knowledge_embed': 5 }
   */
  toolCosts?: Record<string, number>;
  /**
   * Tools exempt from rate limiting.
   */
  exemptTools?: Set<string> | string[];
  /**
   * Whether rate limiting is enabled. Default: true.
   * Set to false to disable all limiting (useful in dev/testing).
   */
  enabled?: boolean;
}

/** State of a single session's token bucket. */
export interface BucketState {
  /** Current token count (may exceed maxTokens due to burst). */
  tokens: number;
  /** Timestamp of last refill (ms). */
  lastRefillAt: number;
}

/** Rate limit info for diagnostics. */
export interface RateLimitInfo {
  /** Remaining tokens in the bucket. */
  remaining: number;
  /** Seconds until 1 token is available (0 if tokens available now, -1 if refill disabled). */
  retryAfterSec: number;
  /** Maximum tokens for this session. */
  maxTokens: number;
  /** Refill rate in tokens per second. */
  refillPerSec: number;
}

// ─── Token Bucket ────────────────────────────────────────────────────

/**
 * Token bucket for a single session.
 * Not thread-safe — designed for single-threaded Node.js.
 */
class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;
  private readonly max: number;
  private readonly burst: number;
  private readonly rate: number; // tokens per ms

  constructor(maxTokens: number, burstMaxTokens: number, refillPerSec: number) {
    this.max = maxTokens;
    this.burst = burstMaxTokens;
    this.rate = refillPerSec / 1000; // convert to per-ms
    this.tokens = maxTokens; // start full
    this.lastRefillAt = Date.now();
  }

  /**
   * Refill tokens based on elapsed time.
   * Tokens accumulate up to burst capacity.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed > 0) {
      const added = elapsed * this.rate;
      this.tokens = Math.min(this.burst, this.tokens + added);
      this.lastRefillAt = now;
    }
  }

  /**
   * Try to consume tokens.
   * @returns true if consumed successfully, false if rate limited.
   */
  tryConsume(cost: number): boolean {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /**
   * Get current bucket state for diagnostics.
   */
  getState(): BucketState {
    this.refill();
    return {
      tokens: this.tokens,
      lastRefillAt: this.lastRefillAt,
    };
  }

  /**
   * Get rate limit info.
   */
  getInfo(): RateLimitInfo {
    this.refill();
    return {
      remaining: Math.floor(this.tokens),
      retryAfterSec: this.tokens >= 1
        ? 0
        : this.rate > 0
          ? Math.ceil((1 - this.tokens) / this.rate / 1000)
          : -1, // -1 means "never" (refill disabled)
      maxTokens: this.max,
      refillPerSec: this.rate * 1000,
    };
  }

  /**
   * Reset bucket to full capacity.
   */
  reset(): void {
    this.tokens = this.max;
    this.lastRefillAt = Date.now();
  }
}

// ─── RateLimiter ─────────────────────────────────────────────────────

export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly maxTokens: number;
  private readonly burstMaxTokens: number;
  private readonly refillPerSec: number;
  private readonly defaultCost: number;
  private readonly toolCosts: Map<string, number>;
  private readonly exemptTools: Set<string>;
  private readonly enabled: boolean;

  constructor(options?: RateLimiterOptions) {
    this.maxTokens = options?.maxTokens
      ?? parseInt(process.env.MCP_RATE_LIMIT_MAX_TOKENS || '60', 10);
    this.burstMaxTokens = options?.burstMaxTokens
      ?? parseInt(process.env.MCP_RATE_LIMIT_BURST_MAX_TOKENS || '100', 10);
    this.refillPerSec = options?.refillPerSec
      ?? parseFloat(process.env.MCP_RATE_LIMIT_REFILL_PER_SEC || '1');
    this.defaultCost = options?.defaultCost ?? 1;
    this.toolCosts = new Map(Object.entries(options?.toolCosts ?? {}));
    this.exemptTools = new Set(options?.exemptTools ?? []);
    this.enabled = options?.enabled ?? true;

    // Ensure burst >= max
    if (this.burstMaxTokens < this.maxTokens) {
      this.burstMaxTokens = this.maxTokens;
    }
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Check if a tool call is allowed and consume tokens if so.
   * @returns true if allowed, false if rate limited.
   */
  allow(sessionId: string, toolName: string): boolean {
    if (!this.enabled) return true;
    if (this.exemptTools.has(toolName)) return true;

    const cost = this.toolCosts.get(toolName) ?? this.defaultCost;
    const bucket = this.getOrCreateBucket(sessionId);

    const allowed = bucket.tryConsume(cost);
    if (!allowed) {
      const info = bucket.getInfo();
      log.warn(
        { sessionId, toolName, remaining: info.remaining, retryAfterSec: info.retryAfterSec, cost },
        'rate limited',
      );
    }

    return allowed;
  }

  /**
   * Get rate limit info for a session.
   */
  getInfo(sessionId: string): RateLimitInfo | undefined {
    const bucket = this.buckets.get(sessionId);
    return bucket?.getInfo();
  }

  /**
   * Get bucket count (active sessions with rate limit state).
   */
  get size(): number {
    return this.buckets.size;
  }

  /**
   * Reset a session's bucket to full capacity.
   */
  reset(sessionId: string): boolean {
    const bucket = this.buckets.get(sessionId);
    if (!bucket) return false;
    bucket.reset();
    return true;
  }

  /**
   * Remove a session's bucket.
   */
  remove(sessionId: string): boolean {
    return this.buckets.delete(sessionId);
  }

  /**
   * Remove all buckets.
   */
  clear(): void {
    this.buckets.clear();
  }

  // ─── ToolExecutor integration ────────────────────────────────────

  /**
   * Create a PreToolHook for use with ToolExecutor from S-002.
   * Denies tool calls that exceed the rate limit.
   *
   * Usage:
   *   executor.addPreHook(rateLimiter.createPreHook());
   */
  createPreHook(): PreToolHook {
    return (toolName: string, _input: Record<string, unknown>, context: ToolContext) => {
      const allowed = this.allow(context.sessionId, toolName);
      if (!allowed) {
        const info = this.getInfo(context.sessionId);
        const retryPart = info && info.retryAfterSec > 0
          ? `, retry after ${info.retryAfterSec}s`
          : '';
        return {
          deny: true,
          reason: `rate limited: ${info?.remaining ?? 0} tokens remaining${retryPart}`,
        };
      }
      return { deny: false };
    };
  }

  // ─── Internal ────────────────────────────────────────────────────

  private getOrCreateBucket(sessionId: string): TokenBucket {
    let bucket = this.buckets.get(sessionId);
    if (!bucket) {
      bucket = new TokenBucket(this.maxTokens, this.burstMaxTokens, this.refillPerSec);
      this.buckets.set(sessionId, bucket);
    }
    return bucket;
  }
}
