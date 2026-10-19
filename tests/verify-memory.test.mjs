import { describe, it, expect } from 'vitest';
import {
  anchorsOf,
  classifyFact,
  buildSuffixIndex,
  resolveRepoPath,
  lineInRange,
  ticketOf,
  branchesFor,
} from '../scripts/verify-memory.mjs';

const FILES = [
  'common/config/main.php',
  'console/controllers/BundleController.php',
  'console/models/bundle/starter/Regular.php',
  'src/search/index.ts',
];

describe('verify-memory anchor parsing', () => {
  it('extracts path anchors with line ranges', () => {
    const anchors = anchorsOf('см. common/config/main.php:20 и Regular.php:43-47');
    expect(anchors).toEqual([
      { kind: 'path', file: 'common/config/main.php', from: 20, to: null, strong: true },
      { kind: 'path', file: 'Regular.php', from: 43, to: 47, strong: true },
    ]);
  });

  it('does not duplicate a file name that is part of a longer path', () => {
    const anchors = anchorsOf('console/models/bundle/starter/Regular.php:43');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ file: 'console/models/bundle/starter/Regular.php', from: 43 });
  });

  it('extracts Class::method anchors', () => {
    expect(anchorsOf('вызывает BundleController::actionRun()')).toEqual([
      { kind: 'symbol', className: 'BundleController', method: 'actionRun', strong: true },
    ]);
  });

  it('treats a bare filename without a line number as a weak anchor', () => {
    expect(anchorsOf('артефакт article-compact.md остаётся локальным')).toEqual([
      { kind: 'path', file: 'article-compact.md', from: null, to: null, strong: false },
    ]);
    expect(anchorsOf('article-compact.md:42')[0].strong).toBe(true);
  });

  it('returns no anchors for prose without files or symbols', () => {
    expect(anchorsOf('просто мысль без якорей')).toEqual([]);
  });
});

describe('verify-memory path resolution', () => {
  const index = buildSuffixIndex(FILES);
  const fileSet = new Set(FILES);

  it('resolves an exact path', () => {
    expect(resolveRepoPath('src/search/index.ts', index, fileSet)).toBe('src/search/index.ts');
  });

  it('resolves a suffix to the tracked file', () => {
    expect(resolveRepoPath('bundle/starter/Regular.php', index, fileSet)).toBe('console/models/bundle/starter/Regular.php');
    expect(resolveRepoPath('main.php', index, fileSet)).toBe('common/config/main.php');
  });

  it('returns undefined for unknown files', () => {
    expect(resolveRepoPath('missing/NotThere.php', index, fileSet)).toBeUndefined();
  });

  it('rejects a line anchor past EOF', () => {
    expect(lineInRange(20, null, 100)).toBe(true);
    expect(lineInRange(120, null, 100)).toBe(false);
    expect(lineInRange(90, 120, 100)).toBe(false);
    expect(lineInRange(1, null, 0)).toBe(false);
  });
});

describe('verify-memory classification', () => {
  const files = ['common/Other.php'];
  const index = {
    fileSet: new Set(files),
    suffixIndex: buildSuffixIndex(files),
    repoTops: new Set(['common']),
    lineCount: () => 10,
  };
  const git = (args) => (args[0] === 'grep' ? '' : '');

  it('verifies a fact whose anchor resolves', () => {
    expect(classifyFact('см. common/Other.php:3', index, git).status).toBe('verified');
  });

  it('marks a fact stale when its repo anchor is gone', () => {
    expect(classifyFact('см. common/models/Gone.php:5', index, git).status).toBe('stale');
  });

  it('marks a fact stale when the line is past EOF', () => {
    expect(classifyFact('см. common/Other.php:99', index, git).status).toBe('stale');
  });

  it('does not mark illustrative non-repo paths as stale', () => {
    expect(classifyFact('пример: tmp/x.php:5', index, git).status).toBe('no-anchor');
  });
});

describe('verify-memory ticket branches', () => {
  it('finds the ticket key in the fact text', () => {
    expect(ticketOf('DEV-7658 (alb-review round 1)')).toBe('DEV-7658');
    expect(ticketOf('no ticket here')).toBeNull();
  });

  it('matches ticket branches by prefix, not equality', () => {
    const branches = ['master', 'DEV-7658-fix-timezone', 'DEV-7658', 'DEV-76580-other'];
    expect(branchesFor('DEV-7658', branches)).toEqual(['DEV-7658-fix-timezone', 'DEV-7658']);
  });
});
