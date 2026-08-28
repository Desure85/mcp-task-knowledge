/**
 * behavioral/guardrail-predictor.ts — Proactive guardrails (BM-008).
 *
 * MCP tool `predict_issue` — checks proposed code BEFORE it is written
 * against known failure patterns learned from resolved failures.
 * Returns warnings with confidence levels + risk assessment.
 *
 * Guard rules are auto-learned from resolved failures (BM-003 + BM-004):
 * each resolved failure contributes a pattern (error type + message keywords
 * + fix hint from the resolution approach).
 *
 * Usage:
 *   const predictor = new GuardrailPredictor(failures, resolutions);
 *   predictor.learn();                       // distill resolved failures
 *   const result = await predictor.predict({ code: 'user.profile.name', file: 'src/a.ts' });
 *   if (!result.safe) { surface the warnings }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { FailureLogger } from './failure-logging.js';
import type { ResolutionLogger } from './resolution-logging.js';

const log = childLogger('guardrail-predictor');

// ─── Types ────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';

export interface GuardPattern {
  /** Unique pattern ID. */
  patternId: string;
  /** Error type of the source failure. */
  errorType: string;
  /** Keywords extracted from the failure message (lowercased). */
  keywords: string[];
  /** Learned risk level. */
  risk: RiskLevel;
  /** Fix hint from the proven resolution approach. */
  fixHint: string;
  /** Source failure ID. */
  sourceFailureId: string;
  /** Source resolution ID. */
  sourceResolutionId: string;
  /** When the pattern was learned (ISO 8601). */
  createdAt: string;
}

export interface PredictInput {
  /** Proposed code / content to check. */
  code: string;
  /** Optional file path (appended to the checked text). */
  file?: string;
  /** Optional intent description (appended to the checked text). */
  intent?: string;
}

export interface PredictWarning {
  /** Guard pattern that fired. */
  patternId: string;
  /** Error type the pattern protects against. */
  errorType: string;
  /** Confidence 0-1 (keyword overlap). */
  confidence: number;
  /** Risk level of the pattern. */
  risk: RiskLevel;
  /** Human-readable warning. */
  message: string;
  /** Fix hint from the proven resolution. */
  fixHint: string;
}

export interface PredictResult {
  /** True when no warnings with high risk + meaningful confidence. */
  safe: boolean;
  /** All warnings found. */
  warnings: PredictWarning[];
  /** Highest risk among warnings ('low' when none). */
  riskLevel: RiskLevel;
  /** Number of guard patterns scanned. */
  patternsScanned: number;
  /** Duration in ms. */
  durationMs: number;
}

export interface GuardrailOptions {
  /** Storage path for learned patterns. Default: '.behavioral'. */
  storagePath?: string;
  /** Auto-learn before each predict. Default: false. */
  autoLearn?: boolean;
  /** Max keywords per pattern. Default: 8. */
  maxKeywords?: number;
}

// ─── Storage ──────────────────────────────────────────────────────

interface GuardrailStorage {
  patterns: GuardPattern[];
}

// High-risk signal keywords (security / crash-prone).
const HIGH_RISK_KEYWORDS = [
  'password', 'secret', 'token', 'key', 'credential', 'injection', 'xss',
  'sql', 'shell', 'exec', 'eval', 'internal', 'undefined', 'null', 'crash',
];

// ─── GuardrailPredictor ───────────────────────────────────────────

export class GuardrailPredictor {
  private readonly failures: FailureLogger;
  private readonly resolutions: ResolutionLogger;
  private readonly storagePath: string;
  private readonly filePath: string;
  private readonly autoLearn: boolean;
  private readonly maxKeywords: number;
  private storage: GuardrailStorage;

  constructor(
    failures: FailureLogger,
    resolutions: ResolutionLogger,
    options?: GuardrailOptions,
  ) {
    this.failures = failures;
    this.resolutions = resolutions;
    this.storagePath = options?.storagePath ?? '.behavioral';
    this.filePath = join(this.storagePath, 'guard-patterns.json');
    this.autoLearn = options?.autoLearn ?? false;
    this.maxKeywords = options?.maxKeywords ?? 8;
    this.storage = this.load();
  }

  /**
   * Learn guard patterns from resolved failures with proven fixes.
   * Returns the newly learned patterns (dedup by errorType + keywords).
   */
  learn(): GuardPattern[] {
    const learned: GuardPattern[] = [];
    const existing = new Set(this.storage.patterns.map((p) => p.patternId));

    for (const resolution of this.resolutions.list()) {
      const failure = this.failures.get(resolution.failureId);
      if (!failure || !failure.resolved) continue;

      const keywords = this.extractKeywords(failure.message);
      if (keywords.length === 0) continue;

      const patternId = `guard-${failure.failureId}`;
      if (existing.has(patternId)) continue;

      const pattern: GuardPattern = {
        patternId,
        errorType: failure.errorType,
        keywords,
        risk: this.assessRisk(failure.errorType, failure.message),
        fixHint: resolution.approach,
        sourceFailureId: failure.failureId,
        sourceResolutionId: resolution.resolutionId,
        createdAt: new Date().toISOString(),
      };
      this.storage.patterns.push(pattern);
      existing.add(patternId);
      learned.push(pattern);
    }

    this.save();
    log.info({ learned: learned.length, total: this.storage.patterns.length }, 'guard patterns learned');
    return learned;
  }

  /**
   * Predict issues in proposed code (`predict_issue`).
   */
  predict(input: PredictInput | string, options?: { autoLearn?: boolean }): PredictResult {
    const startTime = Date.now();
    const autoLearn = options?.autoLearn ?? this.autoLearn;
    if (autoLearn) this.learn();

    const text = this.normalizeInput(input).toLowerCase();
    const warnings: PredictWarning[] = [];

    for (const pattern of this.storage.patterns) {
      const matched = pattern.keywords.filter((kw) => text.includes(kw));
      if (matched.length === 0) continue;

      const confidence = matched.length / Math.max(pattern.keywords.length, 1);
      warnings.push({
        patternId: pattern.patternId,
        errorType: pattern.errorType,
        confidence: Math.round(confidence * 100) / 100,
        risk: pattern.risk,
        message: `Possible ${pattern.errorType}: "${matched[0]}" in proposed code (matches known failure pattern)`,
        fixHint: pattern.fixHint,
      });
    }

    warnings.sort((a, b) => b.confidence - a.confidence);
    const riskLevel = this.highestRisk(warnings);
    const safe = !warnings.some((w) => w.risk === 'high');

    return {
      safe,
      warnings,
      riskLevel,
      patternsScanned: this.storage.patterns.length,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * List learned guard patterns.
   */
  listPatterns(): GuardPattern[] {
    return [...this.storage.patterns];
  }

  get count(): number {
    return this.storage.patterns.length;
  }

  clear(): void {
    this.storage = { patterns: [] };
    this.save();
  }

  // ─── Internal ───────────────────────────────────────────────────

  private normalizeInput(input: PredictInput | string): string {
    if (typeof input === 'string') return input;
    const parts = [input.code];
    if (input.file) parts.push(input.file);
    if (input.intent) parts.push(input.intent);
    return parts.join('\n');
  }

  private extractKeywords(message: string): string[] {
    const words = message.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const unique = Array.from(new Set(words));
    // Skip generic words that add no signal
    const stop = new Set(['cannot', 'error', 'failed', 'failure', 'unexpected', 'expected']);
    const keywords = unique.filter((w) => !stop.has(w));
    return keywords.slice(0, this.maxKeywords);
  }

  private assessRisk(errorType: string, message: string): RiskLevel {
    const haystack = `${errorType} ${message}`.toLowerCase();
    let hits = 0;
    for (const kw of HIGH_RISK_KEYWORDS) {
      if (haystack.includes(kw)) hits++;
    }
    if (hits >= 2) return 'high';
    if (hits === 1) return 'medium';
    return 'low';
  }

  private highestRisk(warnings: PredictWarning[]): RiskLevel {
    if (warnings.some((w) => w.risk === 'high')) return 'high';
    if (warnings.some((w) => w.risk === 'medium')) return 'medium';
    return 'low';
  }

  private load(): GuardrailStorage {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
        return { patterns: data.patterns ?? [] };
      }
    } catch (err) {
      log.warn({ err }, 'failed to load guard patterns, starting fresh');
    }
    return { patterns: [] };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save guard patterns');
    }
  }
}
