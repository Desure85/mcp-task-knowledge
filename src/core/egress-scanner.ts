/**
 * Egress prompt-injection scanner (TR-14 / TR-01 M1).
 *
 * TR-01 audit found that stored content (knowledge docs, memory facts, task
 * descriptions, prompt templates) flows back into LLM context verbatim —
 * no output-side screening existed anywhere. This module scans tool OUTPUT
 * text for injection patterns before it is returned to the model.
 *
 * Design:
 *   - Pure regex heuristics, zero dependencies, no I/O.
 *   - Activated only when SECURITY_STACK=1 (same gate as the input stack).
 *   - Mode via SECURITY_EGRESS_MODE: warn (default) | redact | block.
 *       warn   — prepend a visible warning note to the output text.
 *       redact — replace each matched span with [REDACTED-INJECTION].
 *       block  — replace the whole result with an {ok:false} error envelope.
 *   - Findings report pattern name + matched excerpt + offset so callers can
 *     audit-log exactly what tripped the scanner.
 *
 * This is a heuristic screen, not a sanitizer: it flags suspicious content
 * but (in warn mode) still returns it — matching the TR-01 recommendation
 * "flag, don't strip" for the default posture.
 */

import { childLogger } from './logger.js';

const log = childLogger('egress-scanner');

// ─── Patterns ───────────────────────────────────────────────────────

export interface EgressPattern {
  /** Stable pattern name reported in findings. */
  name: string;
  re: RegExp;
}

/**
 * Injection patterns screened on tool output. Ordered; every pattern is
 * evaluated (no early exit) so findings list the full set of hits.
 */
export const EGRESS_PATTERNS: readonly EgressPattern[] = [
  // Instruction override — classic indirect-injection phrasing.
  {
    name: 'instruction-override',
    re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,80}\b(previous|prior|above|all|your|system|earlier)\b[^.\n]{0,80}\b(instructions?|rules?|prompts?|guidelines?|context)\b/gi,
  },
  {
    name: 'forget-everything',
    re: /\bforget\s+(everything|all|it all|previous)\b/gi,
  },
  {
    name: 'new-instructions',
    re: /\b(new|updated?|real|actual|true)\s+(system\s+)?instructions?\s*:/gi,
  },
  {
    name: 'you-are-now',
    re: /\byou\s+are\s+now\b[^.\n]{0,60}\b(mode|agent|assistant|system|dan|jailbreak)/gi,
  },
  // Role markers — fake system/assistant turns injected into data.
  {
    name: 'role-marker-system',
    re: /(^|\n)\s*system\s*:/gi,
  },
  {
    name: 'role-marker-assistant',
    re: /(^|\n)\s*assistant\s*:/gi,
  },
  {
    name: 'role-marker-heading',
    re: /#{1,6}\s*system\b/gi,
  },
  {
    name: 'special-token',
    re: /<\|(?:im_start|im_end|system|endoftext|inst|\/inst)\|>|\[INST\]|\[\/INST\]|<<SYS>>|<<\/SYS>>/gi,
  },
  // XML / context breakout — closing tags that escape wrapper markup
  // (memory_context_assemble emits <context>/<item> blocks; TR-01 V2).
  {
    name: 'xml-breakout',
    re: /<\/?(?:context|system|item|items|instructions|untrusted-data|prompt|rule|rules)\s*>/gi,
  },
  // Zero-width / bidi unicode — steganographic payload carriers (TR-01 V5).
  // U+200B-U+200D (ZWSP/ZWNJ/ZWJ), U+FEFF (BOM/ZWNBSP), U+202A-U+202E (bidi),
  // U+2060-U+2064 (word joiner / invisible operators).
  {
    name: 'zero-width-char',
    re: /[\u200B-\u200D\uFEFF\u202A-\u202E\u2060-\u2064]/g,
  },
  // Long base64 blob — heuristic for encoded instruction payloads.
  {
    name: 'base64-payload',
    re: /\b[A-Za-z0-9+/]{50,}={0,2}\b/g,
  },
];

// ─── Types ──────────────────────────────────────────────────────────

export type EgressMode = 'warn' | 'redact' | 'block';

export interface EgressFinding {
  /** Pattern name from EGRESS_PATTERNS. */
  pattern: string;
  /** Matched excerpt (truncated to 120 chars). */
  match: string;
  /** Character offset of the match in the scanned text. */
  index: number;
}

export interface EgressScanResult {
  /** Output text after applying the mode (warn note / redactions). */
  clean: string;
  /** All pattern hits, in scan order. Empty = clean content. */
  findings: EgressFinding[];
}

export const EGRESS_WARNING_PREFIX =
  '⚠️ [POTENTIAL PROMPT INJECTION DETECTED]';

export const EGRESS_REDACTED_TOKEN = '[REDACTED-INJECTION]';

// ─── Scanner ────────────────────────────────────────────────────────

export class EgressScanner {
  constructor(private readonly mode: EgressMode = 'warn') {}

  /**
   * Scan output text for injection patterns and apply the configured mode.
   * Returns the (possibly transformed) text plus the findings list.
   */
  scan(text: string): EgressScanResult {
    const findings: EgressFinding[] = [];

    for (const { name, re } of EGRESS_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        findings.push({
          pattern: name,
          match: m[0].length > 120 ? `${m[0].slice(0, 117)}...` : m[0],
          index: m.index,
        });
        // Guard against zero-length matches looping forever.
        if (m[0].length === 0) re.lastIndex += 1;
      }
    }

    if (findings.length === 0) {
      return { clean: text, findings };
    }

    log.warn(
      { mode: this.mode, hits: findings.length, patterns: [...new Set(findings.map((f) => f.pattern))] },
      'egress scanner: injection patterns detected in tool output',
    );

    if (this.mode === 'redact') {
      let clean = text;
      for (const { re } of EGRESS_PATTERNS) {
        re.lastIndex = 0;
        clean = clean.replace(re, EGRESS_REDACTED_TOKEN);
      }
      return { clean, findings };
    }

    // warn (default) and block share the same text transform: a visible
    // warning header. block is handled by the caller which swaps the whole
    // result for an error envelope.
    const summary = [...new Set(findings.map((f) => f.pattern))].join(', ');
    return {
      clean: `${EGRESS_WARNING_PREFIX} patterns: ${summary}\n\n${text}`,
      findings,
    };
  }
}

// ─── Env wiring ─────────────────────────────────────────────────────

/** Parse SECURITY_EGRESS_MODE into a known mode; default 'warn'. */
export function resolveEgressMode(env: NodeJS.ProcessEnv = process.env): EgressMode {
  const v = (env.SECURITY_EGRESS_MODE ?? 'warn').toLowerCase();
  if (v === 'redact' || v === 'block') return v;
  return 'warn';
}

/**
 * Whether egress scanning is active. Requires the security stack gate
 * (SECURITY_STACK=1) — same opt-in as the input side, zero overhead when off.
 */
export function isEgressScanEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SECURITY_STACK ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
