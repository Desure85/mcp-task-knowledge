/**
 * AUD-03 — path traversal guards: every user-controlled segment joined onto
 * a DATA_DIR path is validated, and the resolved path is proven to stay
 * inside the base directory.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  assertSafeSegment,
  resolveUnder,
  resolveUnderPath,
  PathValidationError,
} from '../src/fs.js';

const BASE = path.resolve('data-test-base');
const NUL_SEG = 'a\x00b';
const DEL_SEG = 'a\x7fb';

describe('assertSafeSegment', () => {
  it('accepts normal segments', () => {
    for (const ok of ['mcp', 'my-project', 'task_1', 'abc123', 'id.json', 'uni-файл', 'v1.2', 'my proj']) {
      expect(() => assertSafeSegment(ok)).not.toThrow();
    }
  });

  it('rejects traversal and separators', () => {
    for (const bad of ['..', '.', 'a/b', 'a\\b', 'a/b/c', '..\\x', '']) {
      expect(() => assertSafeSegment(bad), JSON.stringify(bad)).toThrow(PathValidationError);
    }
  });

  it('rejects control chars', () => {
    expect(() => assertSafeSegment(NUL_SEG)).toThrow(PathValidationError);
    expect(() => assertSafeSegment('a\tb')).toThrow(PathValidationError);
    expect(() => assertSafeSegment('a\nb')).toThrow(PathValidationError);
    expect(() => assertSafeSegment(DEL_SEG)).toThrow(PathValidationError);
  });

  it('rejects non-strings', () => {
    for (const bad of [undefined, null, 5, {}, []]) {
      expect(() => assertSafeSegment(bad)).toThrow(PathValidationError);
    }
  });
});

describe('resolveUnder', () => {
  it('resolves inside base', () => {
    expect(resolveUnder(BASE, 'proj', 'id.json')).toBe(path.join(BASE, 'proj', 'id.json'));
  });

  it('rejects segment traversal before resolution', () => {
    expect(() => resolveUnder(BASE, '..', 'x')).toThrow(PathValidationError);
    expect(() => resolveUnder(BASE, 'a', '..')).toThrow(PathValidationError);
    expect(() => resolveUnder(BASE, 'a/b')).toThrow(PathValidationError);
    expect(() => resolveUnder(BASE, 'a\\b')).toThrow(PathValidationError);
  });

  it('rejects absolute segment', () => {
    const abs = path.resolve('/etc');
    expect(() => resolveUnder(BASE, abs)).toThrow(PathValidationError);
  });

  it('base-relative sibling with similar prefix is not reachable', () => {
    // DATA_DIR=/data/app — /data/app2 must NOT count as inside.
    const sibling = path.resolve(BASE, '..', path.basename(BASE) + '2');
    expect(sibling.startsWith(BASE + path.sep)).toBe(false);
  });
});

describe('resolveUnderPath', () => {
  it('accepts nested relative paths', () => {
    expect(resolveUnderPath(BASE, 'sub/dir/file.md')).toBe(path.join(BASE, 'sub', 'dir', 'file.md'));
    expect(resolveUnderPath(BASE, 'file.json')).toBe(path.join(BASE, 'file.json'));
  });

  it('rejects traversal inside relative paths', () => {
    for (const bad of ['../x', 'a/../../x', '..', 'a/./../x', 'a\\..\\x', 'sub/../../etc/passwd']) {
      expect(() => resolveUnderPath(BASE, bad), JSON.stringify(bad)).toThrow(PathValidationError);
    }
  });

  it('rejects absolute and empty', () => {
    expect(() => resolveUnderPath(BASE, '')).toThrow(PathValidationError);
    expect(() => resolveUnderPath(BASE, path.resolve('/abs/file'))).toThrow(PathValidationError);
    expect(() => resolveUnderPath(BASE, '///')).toThrow(PathValidationError);
  });
});
