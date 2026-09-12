/**
 * Security stack — wires the previously dead security services into the
 * tools/call dispatch path (AUD-07).
 *
 * The classes already existed but had zero call sites:
 *   - RateLimiter            (src/core/rate-limiter.ts)
 *   - InputSanitizer         (src/core/input-sanitizer.ts — sanitizeValue)
 *   - ACLEngine              (src/core/acl.ts)
 *   - AuditLogger            (src/audit/logger.ts)
 *   - AuthProtection         (src/core/auth-protection.ts)
 *
 * This module is the single orchestration point. It is invoked from
 * wrapToolHandler() AFTER the auth gate decision, in this order:
 *
 *   1. AuthProtection.check()   — lockout/ban gate (only meaningful for
 *                                 mcp.authenticate, but cheap for others)
 *   2. RateLimiter.allow()      — per-session token bucket
 *   3. sanitizeValue()          — input sanitization (reject mode denies)
 *   4. ACLEngine.evaluate()     — role-based allow/deny
 *   5. handler()                — the actual tool
 *   6. AuditLogger.record()     — tool.call / tool.result / tool.error
 *
 * Enabled via SECURITY_STACK=1 (or 'true'). When disabled the stack is a
 * no-op and wrapToolHandler behaves exactly as before (backwards compat).
 *
 * Each stage returns { allowed:false, reason } on deny; the wrapper turns
 * it into the standard { ok:false, error:{message} } envelope.
 */

import type { RateLimiter } from './rate-limiter.js';
import type { ACLEngine } from './acl.js';
import type { AuthProtection } from './auth-protection.js';
import type { AuditLogger } from '../audit/logger.js';
import {
  sanitizeValue,
  DEFAULT_SANITIZER_CONFIG,
  type SanitizerConfig,
} from './input-sanitizer.js';
import type { AuthManager } from './auth.js';
import { childLogger } from './logger.js';
import {
  EgressScanner,
  type EgressFinding,
  type EgressMode,
} from './egress-scanner.js';

const log = childLogger('security-stack');

// ─── Config ─────────────────────────────────────────────────────────

export interface SecurityStackOptions {
  rateLimiter?: RateLimiter;
  acl?: ACLEngine;
  auditLogger?: AuditLogger;
  authProtection?: AuthProtection;
  /** Sanitizer config; presence enables the sanitizer stage. */
  sanitizer?: SanitizerConfig;
  /** AuthManager — used to resolve caller roles for ACL. */
  authManager?: AuthManager;
  /**
   * Egress scanner mode (TR-14). Presence enables output-side injection
   * screening on tool results: 'warn' annotates, 'redact' rewrites matches,
   * 'block' swaps the result for an error envelope.
   */
  egress?: EgressMode;
}

export interface SecurityStackCall {
  toolName: string;
  sessionId?: string;
  /** Raw tool input (args). */
  input?: unknown;
}

export type SecurityStage =
  | 'auth-protection'
  | 'rate-limit'
  | 'sanitizer'
  | 'acl';

export type SecurityDecision =
  | { allowed: true; sanitizedInput?: unknown }
  | { allowed: false; stage: SecurityStage; reason: string };

// ─── Stack ──────────────────────────────────────────────────────────

export class SecurityStack {
  private readonly sanitizerConfig?: Required<SanitizerConfig>;
  private readonly egressScanner?: EgressScanner;

  constructor(private readonly opts: SecurityStackOptions) {
    this.sanitizerConfig = opts.sanitizer
      ? { ...DEFAULT_SANITIZER_CONFIG, ...opts.sanitizer }
      : undefined;
    this.egressScanner = opts.egress ? new EgressScanner(opts.egress) : undefined;
  }

  /** Whether any stage is configured. */
  get active(): boolean {
    return Boolean(
      this.opts.rateLimiter ||
        this.opts.acl ||
        this.opts.auditLogger ||
        this.opts.authProtection ||
        this.sanitizerConfig ||
        this.egressScanner,
    );
  }

  /**
   * Run the pre-execution stages. Returns a decision; when allowed and the
   * sanitizer rewrote the input, `sanitizedInput` carries the cleaned value.
   */
  check(call: SecurityStackCall): SecurityDecision {
    const id = call.sessionId ?? 'anonymous';

    // 1. AuthProtection — lockout/ban gate.
    if (this.opts.authProtection) {
      const res = this.opts.authProtection.check(id);
      if (!res.allowed) {
        return {
          allowed: false,
          stage: 'auth-protection',
          reason: `access denied: ${res.reason ?? 'identifier locked'}`,
        };
      }
    }

    // 2. Rate limiter — per-session token bucket.
    if (this.opts.rateLimiter) {
      if (!this.opts.rateLimiter.allow(id, call.toolName)) {
        const info = this.opts.rateLimiter.getInfo(id);
        const retry =
          info && info.retryAfterSec > 0 ? `, retry after ${info.retryAfterSec}s` : '';
        return {
          allowed: false,
          stage: 'rate-limit',
          reason: `rate limited: ${info?.remaining ?? 0} tokens remaining${retry}`,
        };
      }
    }

    // 3. Input sanitizer.
    let sanitizedInput = call.input;
    if (this.sanitizerConfig) {
      const result = sanitizeValue(call.input, this.sanitizerConfig);
      if (result.detected) {
        if (this.sanitizerConfig.mode === 'reject') {
          log.warn(
            { toolName: call.toolName, threatType: result.threatType, path: result.path },
            'input rejected by sanitizer',
          );
          return {
            allowed: false,
            stage: 'sanitizer',
            reason: `input validation failed: ${result.description ?? result.threatType ?? 'threat detected'}`,
          };
        }
        if (result.value !== undefined) {
          sanitizedInput = result.value;
        }
      }
    }

    // 4. ACL — role-based allow/deny.
    if (this.opts.acl?.enabled) {
      const roles =
        call.sessionId !== undefined && this.opts.authManager
          ? this.opts.authManager.getRoles(call.sessionId)
          : [];
      const verdict = this.opts.acl.evaluate(call.toolName, roles);
      if (!verdict.allowed) {
        return {
          allowed: false,
          stage: 'acl',
          reason: `access denied by ACL: ${verdict.reason}`,
        };
      }
    }

    return { allowed: true, sanitizedInput };
  }

  /** Record an allowed tool call (phase: before). */
  auditCall(call: SecurityStackCall): void {
    this.opts.auditLogger?.record('tool.call', 'pending', call.toolName, {
      sessionId: call.sessionId,
      input:
        call.input !== null && typeof call.input === 'object'
          ? (call.input as Record<string, unknown>)
          : undefined,
      metadata: { phase: 'before' },
    });
  }

  /** Record the outcome of a tool call (phase: after). */
  auditResult(call: SecurityStackCall, result: unknown, durationMs: number, denied = false): void {
    this.opts.auditLogger?.record('tool.result', denied ? 'denied' : 'success', call.toolName, {
      sessionId: call.sessionId,
      result,
      durationMs,
      metadata: { phase: 'after' },
    });
  }

  /** Record a tool call that threw. */
  auditError(call: SecurityStackCall, error: unknown, durationMs: number): void {
    this.opts.auditLogger?.record('tool.error', 'error', call.toolName, {
      sessionId: call.sessionId,
      error: error instanceof Error ? error.message : String(error),
      durationMs,
      metadata: { phase: 'error' },
    });
  }

  /**
   * Egress scan (TR-14): screen tool OUTPUT text for prompt-injection
   * patterns before it reaches the model. Runs after the handler returns.
   *
   * Modes:
   *   warn   — prepend a warning note to each flagged text item.
   *   redact — replace matched spans with [REDACTED-INJECTION].
   *   block  — replace the whole result with an {ok:false} error envelope.
   *
   * Returns the (possibly transformed) result plus findings. When no scanner
   * is configured or the result has no text content, returns it unchanged.
   */
  scanOutput(
    call: SecurityStackCall,
    result: unknown,
  ): { result: unknown; findings: EgressFinding[] } {
    if (!this.egressScanner || result === null || typeof result !== 'object') {
      return { result, findings: [] };
    }
    const content = (result as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return { result, findings: [] };
    }

    const allFindings: EgressFinding[] = [];
    let mutated = false;
    const newContent = content.map((item) => {
      if (
        item === null ||
        typeof item !== 'object' ||
        (item as { type?: unknown }).type !== 'text' ||
        typeof (item as { text?: unknown }).text !== 'string'
      ) {
        return item;
      }
      const text = (item as { text: string }).text;
      const { clean, findings } = this.egressScanner!.scan(text);
      if (findings.length === 0) return item;
      allFindings.push(...findings);
      mutated = true;
      return { ...(item as Record<string, unknown>), text: clean };
    });

    if (allFindings.length === 0) {
      return { result, findings: [] };
    }

    this.opts.auditLogger?.record('tool.result', 'success', call.toolName, {
      sessionId: call.sessionId,
      metadata: {
        phase: 'egress-scan',
        egressMode: this.opts.egress,
        patterns: [...new Set(allFindings.map((f) => f.pattern))],
        hits: allFindings.length,
      },
    });

    if (this.opts.egress === 'block') {
      return {
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: { message: 'output blocked by egress scanner' },
              }),
            },
          ],
          isError: true,
        },
        findings: allFindings,
      };
    }

    return {
      result: mutated ? { ...(result as Record<string, unknown>), content: newContent } : result,
      findings: allFindings,
    };
  }

  /**
   * Post-call hook for AuthProtection: record a failed mcp.authenticate
   * attempt so repeated failures trigger lockout.
   */
  recordAuthOutcome(call: SecurityStackCall, succeeded: boolean): void {
    if (!this.opts.authProtection || call.toolName !== 'mcp.authenticate') return;
    const id = call.sessionId ?? 'anonymous';
    if (succeeded) {
      this.opts.authProtection.recordSuccess(id);
    } else {
      this.opts.authProtection.recordFailure(id);
    }
  }
}

// ─── Env wiring ─────────────────────────────────────────────────────

/** Whether the security stack is enabled via SECURITY_STACK env var. */
export function isSecurityStackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SECURITY_STACK ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
