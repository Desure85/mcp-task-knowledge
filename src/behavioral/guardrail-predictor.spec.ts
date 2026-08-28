/**
 * behavioral/guardrail-predictor.spec.ts — Tests for GuardrailPredictor (BM-008).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FailureLogger } from './failure-logging.js';
import { ResolutionLogger } from './resolution-logging.js';
import { GuardrailPredictor } from './guardrail-predictor.js';

let testDir: string;
let failures: FailureLogger;
let resolutions: ResolutionLogger;
let predictor: GuardrailPredictor;

function seedResolvedFailure(overrides?: {
  errorType?: string;
  message?: string;
  approach?: string;
}): string {
  const failure = failures.log({
    memoryId: 'intent-old',
    errorType: overrides?.errorType ?? 'TypeError',
    message: overrides?.message ?? 'Cannot read property name of undefined object',
  });
  const resolution = resolutions.log({
    failureId: failure.failureId,
    fixingMemoryId: 'intent-fixer',
    approach: overrides?.approach ?? 'use optional chaining',
  });
  failures.resolve(failure.failureId, resolution.resolutionId);
  return failure.failureId;
}

describe('BM-008: GuardrailPredictor', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    failures = new FailureLogger({ storagePath: testDir });
    resolutions = new ResolutionLogger({ storagePath: testDir });
    predictor = new GuardrailPredictor(failures, resolutions, { storagePath: testDir });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('learn()', () => {
    it('distills resolved failures into guard patterns', () => {
      seedResolvedFailure();
      const learned = predictor.learn();
      expect(learned).toHaveLength(1);
      expect(learned[0].errorType).toBe('TypeError');
      expect(learned[0].keywords.length).toBeGreaterThan(0);
      expect(learned[0].fixHint).toBe('use optional chaining');
      expect(predictor.count).toBe(1);
    });

    it('ignores unresolved failures', () => {
      failures.log({
        memoryId: 'intent-x',
        errorType: 'RangeError',
        message: 'Maximum call stack size exceeded',
      });
      const learned = predictor.learn();
      expect(learned).toEqual([]);
    });

    it('does not duplicate patterns on repeated learn()', () => {
      seedResolvedFailure();
      predictor.learn();
      const second = predictor.learn();
      expect(second).toEqual([]);
      expect(predictor.count).toBe(1);
    });

    it('skips failures with no meaningful keywords', () => {
      failures.log({
        memoryId: 'intent-x',
        errorType: 'Error',
        message: 'error failed',
      });
      const resolution = resolutions.log({
        failureId: failures.getByMemoryId('intent-x')[0].failureId,
        fixingMemoryId: 'intent-fixer',
        approach: 'fix it',
      });
      failures.resolve(failures.getByMemoryId('intent-x')[0].failureId, resolution.resolutionId);

      expect(predictor.learn()).toEqual([]);
    });
  });

  describe('predict()', () => {
    it('returns a warning for code matching a learned pattern', () => {
      seedResolvedFailure({ message: 'Cannot read property name of undefined object' });
      predictor.learn();

      const result = predictor.predict({ code: 'const name = user.name;', file: 'src/a.ts' });
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].errorType).toBe('TypeError');
      expect(result.warnings[0].confidence).toBeGreaterThan(0);
      expect(result.warnings[0].fixHint).toBe('use optional chaining');
      expect(result.patternsScanned).toBe(1);
    });

    it('returns no warnings for clean code', () => {
      seedResolvedFailure({ message: 'Cannot read property name of undefined object' });
      predictor.learn();

      const result = predictor.predict('const x = 42; return x * 2;');
      expect(result.warnings).toEqual([]);
      expect(result.safe).toBe(true);
      expect(result.riskLevel).toBe('low');
    });

    it('accepts plain string input', () => {
      seedResolvedFailure({ message: 'Cannot read property name of undefined object' });
      predictor.learn();
      const result = predictor.predict('user.name is accessed here');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('scales confidence with keyword overlap', () => {
      seedResolvedFailure({ message: 'Cannot read property name of undefined object' });
      predictor.learn();

      const weak = predictor.predict('name of undefined');
      const strong = predictor.predict('cannot read property name of undefined object');

      expect(strong.warnings[0].confidence).toBeGreaterThan(weak.warnings[0].confidence);
    });

    it('flags security-related failures as high risk', () => {
      seedResolvedFailure({
        errorType: 'SecurityError',
        message: 'SQL injection detected in query with password field',
        approach: 'use parameterized queries',
      });
      predictor.learn();

      const result = predictor.predict({ code: 'SELECT * FROM users WHERE password = "x"' });
      const highRisk = result.warnings.find((w) => w.risk === 'high');
      expect(highRisk).toBeDefined();
      expect(result.safe).toBe(false);
      expect(result.riskLevel).toBe('high');
    });

    it('auto-learns when enabled', () => {
      seedResolvedFailure();
      const auto = new GuardrailPredictor(failures, resolutions, {
        storagePath: testDir,
        autoLearn: true,
      });
      const result = auto.predict({ code: 'cannot read property name' });
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('persistence', () => {
    it('patterns survive across instances sharing storage', () => {
      seedResolvedFailure();
      predictor.learn();

      const other = new GuardrailPredictor(failures, resolutions, { storagePath: testDir });
      expect(other.count).toBe(1);
      const result = other.predict({ code: 'cannot read property name' });
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('clear() removes all patterns', () => {
      seedResolvedFailure();
      predictor.learn();
      predictor.clear();
      expect(predictor.count).toBe(0);
    });
  });
});
