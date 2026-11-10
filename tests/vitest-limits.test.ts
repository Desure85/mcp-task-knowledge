import fs from 'node:fs';
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

  it('leaves worker selection to the config in npm scripts and the pre-push hook', () => {
    // TS-01: the config is the single authority. A CLI --maxWorkers in a script would silently
    // override the cores/2 formula (and on a 2-core host would spawn 4 workers).
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.test).not.toContain('--maxWorkers');
    expect(pkg.scripts['test:coverage']).not.toContain('--maxWorkers');
    const hook = fs.readFileSync(new URL('../.husky/pre-push', import.meta.url), 'utf8');
    expect(hook).not.toContain('--maxWorkers');
  });

  it('the exported config actually applies the ceiling', () => {
    const test = (config as { test?: { maxWorkers?: number } }).test;
    expect(test?.maxWorkers).toBe(resolveMaxWorkers());
    expect(test?.maxWorkers).toBeLessThanOrEqual(4);
  });
});
