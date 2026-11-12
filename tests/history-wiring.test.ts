import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const node = process.execPath;
const repo = process.cwd();
const repoUrl = pathToFileURL(repo).href;
describe('MU-03 history wiring', () => {
  it('commits a task write through the service', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'history-wire-'));
    try {
      const script = `
        import { createTask, updateTask } from '${repoUrl}/dist/storage/tasks.js';
        import { closeHistory } from '${repoUrl}/dist/history/service.js';
        const task = await createTask({ project: 'p', title: 'wired' });
        await updateTask('p', task.id, { title: 'wired-2' });
        await new Promise(r => setTimeout(r, 100));
        await closeHistory();
      `;
      writeFileSync(path.join(dir, 'run.mjs'), script);
      const env = { ...process.env, DATA_DIR: dir, HISTORY_ENABLED: '1', NODE_ENV: 'production' };
      const res = spawnSync(node, [path.join(dir, 'run.mjs')], { cwd: repo, env, encoding: 'utf8' });
      expect(res.status, res.stdout + res.stderr).toBe(0);
      expect(existsSync(path.join(dir, '.git'))).toBe(true);
      const log = spawnSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' });
      console.log('DEBUG', dir, res.stdout, res.stderr, log.stdout.slice(0,200));
      expect(log.stdout).toContain('history:');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

