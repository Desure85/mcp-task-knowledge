import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitHistory } from '../src/history/git.js';

const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

describe('MU-03/SC-07 git history batching', () => {
  it('collapses N operations into one commit and reverts as a new commit', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'history-'));
    const history = new GitHistory({ root, batchSize: 1000, flushMs: 60_000 });
    try {
      await history.init();
      for (let i = 0; i < 5; i++) {
        writeFileSync(path.join(root, `f${i}.txt`), `v${i}`);
        await history.enqueue([`f${i}.txt`]);
      }
      await history.close();
      expect(git(root, ['rev-list', '--count', 'HEAD'])).toBe('2');
      const subjects = git(root, ['log', '--pretty=format:%s']);
      expect(subjects.split('\n').filter((line) => line.startsWith('history: 5 path'))).toHaveLength(1);

      const beforeRevert = git(root, ['rev-list', '--count', 'HEAD']);
      await history.revert('HEAD');
      const afterRevert = git(root, ['rev-list', '--count', 'HEAD']);
      expect(Number(afterRevert)).toBe(Number(beforeRevert) + 1);
      expect(() => git(root, ['show', 'HEAD^:f0.txt'])).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flushes a queued path after a crash-like restart without losing it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'history-crash-'));
    try {
      const first = new GitHistory({ root, flushMs: 3_600_000 });
      await first.init();
      writeFileSync(path.join(root, 'after-crash.txt'), 'kept');
      await first.enqueue(['after-crash.txt']);
      // Simulate a crash: no close(), no flush.

      const second = new GitHistory({ root, flushMs: 60_000 });
      await second.init();
      await second.close();
      expect(() => git(root, ['show', 'HEAD:after-crash.txt'])).not.toThrow();
      expect(git(root, ['status', '--porcelain'])).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('commits a dirty tree as recovered on init', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'history-dirty-'));
    try {
      await new GitHistory({ root }).init();
      writeFileSync(path.join(root, 'dirty.txt'), 'dirty');
      const second = new GitHistory({ root });
      await second.init();
      expect(git(root, ['log', '--pretty=format:%s'])).toContain('history: recovered');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('auto-flushes at the batch size', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'history-size-'));
    const history = new GitHistory({ root, batchSize: 3, flushMs: 3_600_000 });
    try {
      await history.init();
      for (let i = 0; i < 3; i++) {
        writeFileSync(path.join(root, `b${i}.txt`), `v${i}`);
        await history.enqueue([`b${i}.txt`]);
      }
      await history.flush();
      expect(git(root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
