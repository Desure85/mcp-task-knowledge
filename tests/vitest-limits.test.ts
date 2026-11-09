import { describe, it, expect } from 'vitest';
import config, { resolveMaxWorkers } from '../vitest.config.js';

describe('TS-01 worker ceiling', () => {
  it('caps a many-core host at 4 workers', () => {
    expect(resolveMaxWorkers(72, undefined)).toBe(4);
    expect(resolveMaxWorkers(64, '')).toBe(4);
    expect(resolveMaxWorkers(16, undefined)).toBe(4);
  });

  it('scales down instead of oversubscribing small hosts', () => {
    expect(resolveMaxWorkers(8, undefined)).toBe(4);
    expect(resolveMaxWorkers(4, undefined)).toBe(2);
    expect(resolveMaxWorkers(2, undefined)).toBe(1);
    expect(resolveMaxWorkers(1, undefined)).toBe(1);
  });

  it('honours VITEST_MAX_WORKERS and ignores invalid values', () => {
    expect(resolveMaxWorkers(72, '1')).toBe(1);
    expect(resolveMaxWorkers(72, '3')).toBe(3);
    expect(resolveMaxWorkers(72, '0')).toBe(4);
    expect(resolveMaxWorkers(72, '-2')).toBe(4);
    expect(resolveMaxWorkers(72, 'garbage')).toBe(4);
  });

  it('the exported config actually applies the ceiling', () => {
    const test = (config as { test?: { maxWorkers?: number } }).test;
    expect(test?.maxWorkers).toBe(resolveMaxWorkers());
    expect(test?.maxWorkers).toBeLessThanOrEqual(4);
  });
});
